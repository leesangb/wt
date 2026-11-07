import { expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

const expected = [{
  author: "tester",
  headRefName: "feature",
  isDraft: false,
  number: "7",
  title: "Synthetic PR",
}];

async function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "wt-completion-cache-"));
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const home = join(root, "home");
  const ghConfig = join(root, "gh-config");
  const cacheDirectory = join(root, "cache", "wt", "pr-completions");
  for (const path of [repo, bin, home, ghConfig]) mkdirSync(path, { recursive: true });
  const init = Bun.spawn(["git", "init", "-q", "-b", "main", repo], { stdout: "ignore", stderr: "pipe" });
  if (await init.exited !== 0) throw new Error(await new Response(init.stderr).text());
  const responsePath = join(root, "response.json");
  const modePath = join(root, "mode");
  const logPath = join(root, "calls.log");
  writeFileSync(responsePath, JSON.stringify([{
    author: { login: "tester" }, headRefName: "feature", isDraft: false,
    number: 7, title: "Synthetic PR",
  }]));
  writeFileSync(modePath, "success");
  writeFileSync(join(bin, "gh"), `#!/bin/sh
printf 'call\\n' >> "$WT_GH_LOG"
if [ "$(cat "$WT_GH_MODE")" = fail ]; then exit 1; fi
cat "$WT_GH_RESPONSE"
`, { mode: 0o755 });
  const modulePath = fileURLToPath(new URL("./completion-cache.ts", import.meta.url));
  const script = join(root, "run.ts");
  writeFileSync(script, `
    import { listCachedOpenPullRequests } from ${JSON.stringify(modulePath)};
    console.log(JSON.stringify(await listCachedOpenPullRequests(process.argv[2])));
  `);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    HOME: home,
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_CONFIG_HOME: join(root, "config"),
    GH_CONFIG_DIR: ghConfig,
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    GH_HOST: "github.com",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "global.gitconfig"),
    WT_GH_LOG: logPath,
    WT_GH_MODE: modePath,
    WT_GH_RESPONSE: responsePath,
  };
  async function run(extraEnv: Record<string, string> = {}, cwd = repo) {
    const child = Bun.spawn([process.execPath, script, cwd], {
      env: { ...env, ...extraEnv }, stdout: "pipe", stderr: "pipe",
    });
    const [status, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    const value: unknown = JSON.parse(stdout);
    return value;
  }
  function cachePath() {
    const files = readdirSync(cacheDirectory);
    expect(files).toHaveLength(1);
    return join(cacheDirectory, files[0]!);
  }
  const calls = () => readFileSync(logPath, "utf-8").trim().split("\n").length;
  return { root, repo, ghConfig, cacheDirectory, responsePath, modePath, run, cachePath, calls };
}

test("PR suggestions persist across invocations, expire, and use private cache permissions", async () => {
  const fixture = await createFixture();
  try {
    expect(await fixture.run()).toEqual(expected);
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(1);
    expect(statSync(fixture.cacheDirectory).mode & 0o777).toBe(0o700);
    expect(statSync(fixture.cachePath()).mode & 0o777).toBe(0o600);

    const payload: unknown = JSON.parse(readFileSync(fixture.cachePath(), "utf-8"));
    if (!payload || typeof payload !== "object") throw new Error("cache payload missing");
    writeFileSync(fixture.cachePath(), JSON.stringify({ ...payload, savedAt: Date.now() - 5_001 }));
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(2);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("PR suggestion cache isolates tokens, hosts, Git config, and gh account metadata", async () => {
  const fixture = await createFixture();
  try {
    const context = { GH_TOKEN: "synthetic-secret-token-a", GH_HOST: "github.com" };
    expect(await fixture.run(context)).toEqual(expected);
    expect(await fixture.run(context)).toEqual(expected);
    expect(fixture.calls()).toBe(1);
    expect(await fixture.run({ ...context, GH_TOKEN: "synthetic-secret-token-b" })).toEqual(expected);
    expect(fixture.calls()).toBe(2);
    const enterprise = { GH_TOKEN: "synthetic-secret-token-b", GH_HOST: "enterprise.invalid" };
    expect(await fixture.run(enterprise)).toEqual(expected);
    expect(fixture.calls()).toBe(3);
    writeFileSync(join(fixture.ghConfig, "hosts.yml"), "synthetic account change\n");
    expect(await fixture.run(enterprise)).toEqual(expected);
    expect(fixture.calls()).toBe(4);
    writeFileSync(join(fixture.repo, ".git", "config"), '[remote "origin"]\nurl=https://example.invalid/changed.git\n');
    expect(await fixture.run(enterprise)).toEqual(expected);
    expect(fixture.calls()).toBe(5);
    writeFileSync(join(fixture.root, "global.gitconfig"), '[url "https://other.invalid/"]\ninsteadOf=https://example.invalid/\n');
    expect(await fixture.run(enterprise)).toEqual(expected);
    expect(fixture.calls()).toBe(6);
    expect(readFileSync(fixture.cachePath(), "utf-8")).not.toContain("synthetic-secret-token");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("linked-worktree PR cache invalidates shared and worktree Git configuration", async () => {
  const fixture = await createFixture();
  try {
    for (const args of [
      ["-c", "user.name=tester", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", "base"],
      ["worktree", "add", "-b", "linked", join(fixture.root, "linked")],
    ]) {
      const child = Bun.spawn(["git", "-C", fixture.repo, ...args], { stdout: "ignore", stderr: "pipe" });
      expect(await child.exited).toBe(0);
    }
    const linked = join(fixture.root, "linked");
    expect(await fixture.run({}, linked)).toEqual(expected);
    expect(await fixture.run({}, linked)).toEqual(expected);
    expect(fixture.calls()).toBe(1);
    writeFileSync(join(fixture.repo, ".git", "config"), '[remote "origin"]\nurl=https://example.invalid/shared.git\n');
    expect(await fixture.run({}, linked)).toEqual(expected);
    expect(fixture.calls()).toBe(2);
    writeFileSync(join(fixture.repo, ".git", "worktrees", "linked", "config.worktree"), '[remote "origin"]\nurl=https://example.invalid/worktree.git\n');
    expect(await fixture.run({}, linked)).toEqual(expected);
    expect(fixture.calls()).toBe(3);
    const switchHead = Bun.spawn(["git", "-C", linked, "symbolic-ref", "HEAD", "refs/heads/other"], {
      stdout: "ignore", stderr: "pipe",
    });
    expect(await switchHead.exited).toBe(0);
    expect(await fixture.run({}, linked)).toEqual(expected);
    expect(fixture.calls()).toBe(4);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("PR cache tracks effective remote changes in global and repository includes", async () => {
  const fixture = await createFixture();
  try {
    const globalInclude = join(fixture.root, "included-global.gitconfig");
    const repoInclude = join(fixture.root, "included-repo.gitconfig");
    writeFileSync(globalInclude, '[url "https://first.invalid/"]\ninsteadOf=https://example.invalid/\n');
    writeFileSync(repoInclude, '[remote "origin"]\nurl=https://example.invalid/first.git\n');
    writeFileSync(join(fixture.root, "global.gitconfig"), `[include]\npath=${globalInclude}\n`);
    writeFileSync(join(fixture.repo, ".git", "config"), `[include]\npath=${repoInclude}\n`);
    expect(await fixture.run()).toEqual(expected);
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(1);
    writeFileSync(globalInclude, '[url "https://second.invalid/"]\ninsteadOf=https://example.invalid/\n');
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(2);
    writeFileSync(repoInclude, '[remote "origin"]\nurl=https://secret-config-value@example.invalid/second.git\n');
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(3);
    expect(readFileSync(fixture.cachePath(), "utf-8")).not.toContain("secret-config-value");
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("PR cache tracks includeIf onbranch changes and edits to the selected include", async () => {
  const fixture = await createFixture();
  try {
    const mainConfig = join(fixture.root, "main.gitconfig");
    const otherConfig = join(fixture.root, "other.gitconfig");
    writeFileSync(mainConfig, '[remote "origin"]\nurl=https://example.invalid/main.git\n');
    writeFileSync(otherConfig, '[remote "origin"]\nurl=https://example.invalid/other.git\n');
    writeFileSync(join(fixture.root, "global.gitconfig"),
      `[includeIf "onbranch:main"]\npath=${mainConfig}\n[includeIf "onbranch:other"]\npath=${otherConfig}\n`);
    expect(await fixture.run()).toEqual(expected);
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(1);
    const switchHead = Bun.spawn(["git", "-C", fixture.repo, "symbolic-ref", "HEAD", "refs/heads/other"], {
      stdout: "ignore", stderr: "pipe",
    });
    expect(await switchHead.exited).toBe(0);
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(2);
    writeFileSync(otherConfig, '[remote "origin"]\nurl=https://example.invalid/changed-other.git\n');
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(3);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("failed PR queries are not cached but successful empty suggestions are", async () => {
  const fixture = await createFixture();
  try {
    writeFileSync(fixture.modePath, "fail");
    expect(await fixture.run()).toEqual([]);
    expect(await fixture.run()).toEqual([]);
    expect(fixture.calls()).toBe(2);
    writeFileSync(fixture.modePath, "success");
    writeFileSync(fixture.responsePath, "[]");
    expect(await fixture.run()).toEqual([]);
    expect(await fixture.run()).toEqual([]);
    expect(fixture.calls()).toBe(3);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("invalid, malformed, and future-dated PR cache records fall back to fresh queries", async () => {
  const fixture = await createFixture();
  try {
    expect(await fixture.run()).toEqual(expected);
    writeFileSync(fixture.cachePath(), "not-json");
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(2);
    const payload: unknown = JSON.parse(readFileSync(fixture.cachePath(), "utf-8"));
    if (!payload || typeof payload !== "object") throw new Error("cache payload missing");
    writeFileSync(fixture.cachePath(), JSON.stringify({ ...payload, entries: [{ number: "7" }] }));
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(3);
    writeFileSync(fixture.cachePath(), JSON.stringify({ ...payload, savedAt: Date.now() + 10_000 }));
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(4);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("unwritable optional PR cache does not prevent fresh suggestions", async () => {
  const fixture = await createFixture();
  try {
    const blocked = join(fixture.root, "blocked-cache");
    writeFileSync(blocked, "not a directory");
    expect(await fixture.run({ XDG_CACHE_HOME: blocked })).toEqual(expected);
    expect(await fixture.run({ XDG_CACHE_HOME: blocked })).toEqual(expected);
    expect(fixture.calls()).toBe(2);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("unreadable effective Git configuration disables the optional PR cache", async () => {
  const fixture = await createFixture();
  try {
    expect(await fixture.run()).toEqual(expected);
    writeFileSync(join(fixture.repo, ".git", "config"), "[invalid configuration\n");
    expect(await fixture.run()).toEqual(expected);
    expect(await fixture.run()).toEqual(expected);
    expect(fixture.calls()).toBe(3);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
