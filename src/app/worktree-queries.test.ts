import { afterEach, expect, test } from "bun:test";
import { $ } from "bun";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const tempDirs: string[] = [];
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

afterEach(() => {
  for (const path of tempDirs.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "wt-query-test-"));
  tempDirs.push(root);
  const repo = join(root, "repo");
  const worktree = join(root, "feature");
  const bin = join(root, "bin");
  mkdirSync(bin);
  await $`git init -b main ${repo}`.quiet();
  await $`git -C ${repo} config user.email test@example.com`.quiet();
  await $`git -C ${repo} config user.name tester`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false commit --allow-empty -m initial`.quiet();
  await $`git -C ${repo} remote add origin https://example.invalid/project.git`.quiet();
  await $`git -C ${repo} update-ref refs/remotes/origin/main HEAD`.quiet();
  await $`git -C ${repo} symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.quiet();
  await $`git -C ${repo} worktree add -b feature ${worktree}`.quiet();
  await $`git -C ${repo} update-ref refs/remotes/origin/feature HEAD`.quiet();
  const realGit = Bun.which("git");
  if (!realGit) throw new Error("git is required");

  writeFileSync(join(bin, "git"), `#!/bin/sh
printf '%s\\n' "$*" >> "$WT_GIT_LOG"
if [ "$WT_OVERLAP" = 1 ] && [ "$3" = status ]; then
  : > "$WT_STATUS_STARTED"
  attempts=0
  while [ ! -f "$WT_GH_STARTED" ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -gt 200 ]; then exit 1; fi
    sleep 0.01
  done
fi
exec "$WT_REAL_GIT" "$@"
`, { mode: 0o755 });
  writeFileSync(join(bin, "gh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$WT_GH_LOG"
: > "$WT_GH_STARTED"
if [ "$WT_OVERLAP" = 1 ]; then
  attempts=0
  while [ ! -f "$WT_STATUS_STARTED" ]; do
    attempts=$((attempts + 1))
    if [ "$attempts" -gt 200 ]; then exit 1; fi
    sleep 0.01
  done
fi
if [ "$WT_GH_FAIL" = 1 ]; then
  printf 'offline\\n' >&2
  exit 1
fi
printf '%s\\n' '[{"number":7,"url":"https://example.invalid/pr/7","headRefName":"feature"}]'
`, { mode: 0o755 });

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    WT_REAL_GIT: realGit,
    WT_GIT_LOG: join(root, "git.log"),
    WT_GH_LOG: join(root, "gh.log"),
    WT_STATUS_STARTED: join(root, "status.started"),
    WT_GH_STARTED: join(root, "gh.started"),
  };

  async function run(code: string, extraEnv: Record<string, string> = {}) {
    const script = join(root, "run.ts");
    writeFileSync(script, code);
    const child = Bun.spawn([process.execPath, script], {
      env: { ...env, ...extraEnv },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    return JSON.parse(stdout);
  }

  return { root, repo, worktree, bin, env, run };
}

function modulePath(path: string) {
  return JSON.stringify(join(sourceRoot, path));
}

test("list overlaps GitHub with local status and resolves each base once per call", async () => {
  const fixture = await createFixture();
  writeFileSync(join(fixture.worktree, "local-change"), "pending");
  const result = await fixture.run(`
    import { listWorktrees } from ${modulePath("app/use-cases/list-worktrees.ts")};
    const first = await listWorktrees(${JSON.stringify(fixture.repo)});
    const second = await listWorktrees(${JSON.stringify(fixture.repo)});
    console.log(JSON.stringify([first, second]));
  `, { WT_OVERLAP: "1" });

  expect(result[0].worktrees.find((wt: { branch: string }) => wt.branch === "feature")).toMatchObject({
    prNumber: "7",
    modifiedCount: 1,
  });
  expect(result[1]).toEqual(result[0]);
  const commands = readFileSync(fixture.env.WT_GIT_LOG, "utf-8").split("\n");
  expect(commands.filter(command => command.endsWith("rev-parse --verify origin/main^{commit}"))).toHaveLength(2);
  expect(commands.filter(command => command.endsWith("worktree list --porcelain"))).toHaveLength(2);
});

test("removal details share one status snapshot and execution checks a fresh snapshot", async () => {
  const fixture = await createFixture();
  writeFileSync(join(fixture.worktree, "first"), "one");
  writeFileSync(join(fixture.worktree, "second"), "two");
  const result = await fixture.run(`
    import { inspectRemoval, executeRemoval } from ${modulePath("app/use-cases/remove-worktree.ts")};
    const plan = await inspectRemoval(${JSON.stringify(fixture.worktree)}, ${JSON.stringify(fixture.repo)}, {
      includeStatusEntries: true, statusEntryLimit: 1,
    });
    await Bun.write(${JSON.stringify(join(fixture.worktree, "third"))}, "three");
    const result = await executeRemoval(plan, { execution: "foreground" });
    console.log(JSON.stringify({plan, result}));
  `);
  expect(result.plan.localChangeCount).toBe(2);
  expect(result.plan.statusEntries).toHaveLength(1);
  expect(result.plan.remainingStatusEntryCount).toBe(1);
  expect(result.result.status).toBe("plan_stale");
  expect(result.result.latestPlan.localChangeCount).toBe(3);
  const commands = readFileSync(fixture.env.WT_GIT_LOG, "utf-8").split("\n");
  expect(commands.filter(command => command.includes(" status "))).toHaveLength(2);
  expect(commands.some(command => command.includes("worktree remove"))).toBeFalse();
});

test("a new catalog call does not retain a previously missing default branch", async () => {
  const fixture = await createFixture();
  await $`git -C ${fixture.repo} symbolic-ref --delete refs/remotes/origin/HEAD`.quiet();
  const result = await fixture.run(`
    import { loadWorktreeRemovalInfos } from ${modulePath("app/worktree-catalog.ts")};
    const context = {cwd: ${JSON.stringify(fixture.repo)}, repoRoot: ${JSON.stringify(fixture.repo)}, repoName: "project"};
    const before = await loadWorktreeRemovalInfos(context);
    await Bun.spawn(["git", "-C", context.repoRoot, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], {stdout: "ignore", stderr: "ignore"}).exited;
    const after = await loadWorktreeRemovalInfos(context);
    console.log(JSON.stringify({before, after}));
  `);
  expect(result.before.every((wt: { mergeStatus: string }) => wt.mergeStatus === "unknown")).toBeTrue();
  expect(result.after.every((wt: { mergeStatus: string }) => wt.mergeStatus === "merged")).toBeTrue();
  const commands = readFileSync(fixture.env.WT_GIT_LOG, "utf-8").split("\n");
  expect(commands.filter(command => command.endsWith("symbolic-ref refs/remotes/origin/HEAD"))).toHaveLength(2);
});

test("stored PR links skip GitHub and a failed GitHub query keeps local results", async () => {
  const fixture = await createFixture();
  const failed = await fixture.run(`
    import { listWorktrees } from ${modulePath("app/use-cases/list-worktrees.ts")};
    console.log(JSON.stringify(await listWorktrees(${JSON.stringify(fixture.repo)})));
  `, { WT_GH_FAIL: "1" });
  expect(failed.worktrees).toHaveLength(2);
  for (const path of [fixture.repo, fixture.worktree]) {
    mkdirSync(join(path, ".wt"));
    writeFileSync(join(path, ".wt", "meta.json"), JSON.stringify({ prUrl: "https://example.invalid/stored" }));
  }
  const callsBefore = readFileSync(fixture.env.WT_GH_LOG, "utf-8");
  await fixture.run(`
    import { listWorktrees } from ${modulePath("app/use-cases/list-worktrees.ts")};
    console.log(JSON.stringify(await listWorktrees(${JSON.stringify(fixture.repo)})));
  `);
  expect(readFileSync(fixture.env.WT_GH_LOG, "utf-8")).toBe(callsBefore);
});

test("missing GitHub CLI preserves optional-list fallback and readiness error", async () => {
  const fixture = await createFixture();
  rmSync(join(fixture.bin, "gh"));
  const result = await fixture.run(`
    import { listPullRequestLinks, ensureGithubCliReady } from ${modulePath("infra/github/cli.ts")};
    const links = await listPullRequestLinks(${JSON.stringify(fixture.repo)});
    let message;
    try { await ensureGithubCliReady(${JSON.stringify(fixture.repo)}); }
    catch (error) { message = error.message; }
    console.log(JSON.stringify({size: links.size, message}));
  `, { PATH: fixture.bin });
  expect(result).toEqual({ size: 0, message: "GitHub CLI (`gh`) is not installed" });
});
