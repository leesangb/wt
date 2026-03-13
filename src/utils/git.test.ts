import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import { branchExists, createWorktree } from "./git.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function initRepo(repoRoot: string): Promise<void> {
  await $`git init -b main ${repoRoot}`.quiet();
  await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
  await $`git -C ${repoRoot} config user.name tester`.quiet();
  await Bun.write(join(repoRoot, "README.md"), "base\n");
  await $`git -C ${repoRoot} add README.md`.quiet();
  await $`git -C ${repoRoot} commit -m init`.quiet();
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("createWorktree", () => {
  test("removes the new worktree and branch when push fails", async () => {
    const previousCwd = process.cwd();
    const repoRoot = makeTempDir("wt-git-test-");
    const worktreeRoot = makeTempDir("wt-git-test-worktrees-");
    const worktreePath = join(worktreeRoot, "repo-feature-fail");

    await initRepo(repoRoot);
    process.chdir(repoRoot);

    try {
      await expect(
        createWorktree(worktreePath, "feature/push-fail", "main", true)
      ).rejects.toThrow("git push failed with exit code 128");

      expect(await Bun.file(worktreePath).exists()).toBeFalse();
      expect(await branchExists("feature/push-fail")).toBeFalse();
    } finally {
      process.chdir(previousCwd);
    }
  });
});
