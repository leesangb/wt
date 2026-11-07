import { expect, test } from "bun:test";
import { $ } from "bun";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "wt-pr-query-"));
  const repo = join(root, "repo");
  const worktree = join(root, "feature");
  const bin = join(root, "bin");
  mkdirSync(bin);
  await $`git init -b main ${repo}`.quiet();
  await $`git -C ${repo} config user.name tester`.quiet();
  await $`git -C ${repo} config user.email test@example.invalid`.quiet();
  await $`git -C ${repo} -c commit.gpgsign=false commit --allow-empty -m initial`.quiet();
  await $`git -C ${repo} remote add origin https://example.invalid/project.git`.quiet();
  await $`git -C ${repo} worktree add -b feature ${worktree}`.quiet();
  const head = (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
  const log = join(root, "gh.log");
  writeFileSync(join(bin, "gh"), `#!/bin/sh
printf '%s\\n' "$*" >> "$GH_TEST_LOG"
if [ "$GH_TEST_MODE" = unavailable ]; then exit 127; fi
if [ "$1" = --version ]; then printf 'gh version test\\n'; exit 0; fi
if [ "$1 $2" = 'auth status' ]; then
  if [ "$GH_TEST_MODE" = unauthenticated ]; then exit 1; fi
  exit 0
fi
if [ "$1 $2" = 'pr view' ]; then
  if [ "$GH_TEST_MODE" = unauthenticated ]; then exit 4; fi
  if [ "$GH_TEST_MODE" = request-failed ]; then printf 'PR not found\\n' >&2; exit 1; fi
  printf '%s\\n' "$GH_TEST_PAYLOAD"
  exit 0
fi
exit 2
`, { mode: 0o755 });
  const modulePath = fileURLToPath(new URL("./create-pr-worktree.ts", import.meta.url));
  const script = join(root, "run.ts");
  writeFileSync(script, `
    import { createPrWorktree } from ${JSON.stringify(modulePath)};
    try { console.log(JSON.stringify(await createPrWorktree("7", ${JSON.stringify(repo)}))); }
    catch (error) { console.log(JSON.stringify({ error: error.message })); }
  `);
  async function run(mode = "success") {
    const child = Bun.spawn([process.execPath, script], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_TEST_MODE: mode,
        GH_TEST_LOG: log,
        GH_TEST_PAYLOAD: JSON.stringify({ author: { login: "tester" }, baseRefName: "main", headRefName: "feature", headRefOid: head, number: 7, title: "Test PR", url: "https://example.invalid/pr/7" }),
      },
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
  return { root, repo: realpathSync(repo), worktree: realpathSync(worktree), log, run };
}

test("a successful PR reuse performs one authenticated request and carries its repository root", async () => {
  const fixture = await createFixture();
  try {
    const result = await fixture.run();
    expect(readFileSync(fixture.log, "utf-8").trim().split("\n")).toEqual([
      "pr view 7 --json author,baseRefName,headRefName,headRefOid,number,title,url",
    ]);
    expect(result).toMatchObject({ worktreePath: fixture.worktree, reusedExisting: true, repoRoot: fixture.repo });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("failed PR requests retain authentication and installation diagnostics", async () => {
  const fixture = await createFixture();
  try {
    expect(await fixture.run("unauthenticated")).toEqual({ error: "GitHub CLI is not authenticated. Run `gh auth login`." });
    expect(await fixture.run("unavailable")).toEqual({ error: "GitHub CLI (`gh`) is not installed" });
    expect(await fixture.run("request-failed")).toEqual({ error: "Could not load PR #7: PR not found" });
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
