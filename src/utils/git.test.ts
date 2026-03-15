import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import {
  getWorktreeStatusSummary,
  isBranchMergedToRemote,
} from "./git.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("isBranchMergedToRemote", () => {
  test("checks merge status against the worktree base branch", async () => {
    const previousCwd = process.cwd();
    const originDir = makeTempDir("wt-origin-");
    const repoRoot = makeTempDir("wt-repo-");
    const worktreeRoot = makeTempDir("wt-worktrees-");
    const worktreePath = join(worktreeRoot, "repo-feature");

    await $`git init --bare ${originDir}`.quiet();
    await $`git clone ${originDir} ${repoRoot}`.quiet();
    await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
    await $`git -C ${repoRoot} config user.name tester`.quiet();
    await $`git -C ${repoRoot} checkout -b trunk`.quiet();
    await Bun.write(join(repoRoot, "README.md"), "base\n");
    await $`git -C ${repoRoot} add README.md`.quiet();
    await $`git -C ${repoRoot} commit -m base`.quiet();
    await $`git -C ${repoRoot} push -u origin trunk`.quiet();
    await $`git -C ${repoRoot} remote set-head origin trunk`.quiet();
    await $`git -C ${repoRoot} worktree add -b feature/trunk-test ${worktreePath} trunk`.quiet();
    await Bun.write(join(worktreePath, "README.md"), "feature\n");
    await $`git -C ${worktreePath} add README.md`.quiet();
    await $`git -C ${worktreePath} commit -m feature`.quiet();
    await $`git -C ${worktreePath} push -u origin feature/trunk-test`.quiet();
    await $`git -C ${repoRoot} merge --no-ff feature/trunk-test -m merge-feature`.quiet();
    await $`git -C ${repoRoot} push origin trunk`.quiet();

    process.chdir(repoRoot);

    try {
      expect(
        await isBranchMergedToRemote("feature/trunk-test", "trunk")
      ).toBeTrue();
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe("getWorktreeStatusSummary", () => {
  test("keeps ahead count based on origin branch even without an upstream", async () => {
    const originDir = makeTempDir("wt-origin-");
    const repoRoot = makeTempDir("wt-repo-");

    await $`git init --bare ${originDir}`.quiet();
    await $`git clone ${originDir} ${repoRoot}`.quiet();
    await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
    await $`git -C ${repoRoot} config user.name tester`.quiet();
    await Bun.write(join(repoRoot, "README.md"), "base\n");
    await $`git -C ${repoRoot} add README.md`.quiet();
    await $`git -C ${repoRoot} commit -m base`.quiet();
    await $`git -C ${repoRoot} push -u origin main`.quiet();
    await $`git -C ${repoRoot} checkout -b feature`.quiet();
    await $`git -C ${repoRoot} push origin feature`.quiet();

    await Bun.write(join(repoRoot, "README.md"), "base\nlocal-change\n");
    await Bun.write(join(repoRoot, "UNTRACKED.md"), "new\n");
    await $`git -C ${repoRoot} commit --allow-empty -m ahead`.quiet();

    expect(await getWorktreeStatusSummary(repoRoot, "feature")).toEqual({
      unpushedCount: 1,
      modifiedCount: 2,
    });
  });
});
