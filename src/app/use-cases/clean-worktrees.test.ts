import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { $ } from "bun";
import { planWorktreeCleanup } from "./clean-worktrees.js";

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

describe("planWorktreeCleanup", () => {
  test("can include unmatched worktrees so interactive cleanup can adjust the selection", async () => {
    const originDir = makeTempDir("wt-origin-");
    const repoRoot = makeTempDir("wt-repo-");
    const worktreeRoot = makeTempDir("wt-worktrees-");
    const repoName = basename(originDir).replace(/\.git$/, "");
    const mergedWorktreePath = join(worktreeRoot, `${repoName}-merged`);
    const openWorktreePath = join(worktreeRoot, `${repoName}-open`);

    await $`git init --bare ${originDir}`.quiet();
    await $`git clone ${originDir} ${repoRoot}`.quiet();
    await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
    await $`git -C ${repoRoot} config user.name tester`.quiet();
    await $`git -C ${repoRoot} checkout -b main`.quiet();
    await Bun.write(join(repoRoot, "README.md"), "base\n");
    await $`git -C ${repoRoot} add README.md`.quiet();
    await $`git -C ${repoRoot} commit -m base`.quiet();
    await $`git -C ${repoRoot} push -u origin main`.quiet();
    await $`git -C ${repoRoot} remote set-head origin main`.quiet();

    await $`git -C ${repoRoot} worktree add -b feature/merged ${mergedWorktreePath} main`.quiet();
    await Bun.write(join(mergedWorktreePath, "README.md"), "base\nmerged\n");
    await $`git -C ${mergedWorktreePath} add README.md`.quiet();
    await $`git -C ${mergedWorktreePath} commit -m merged`.quiet();
    await $`git -C ${mergedWorktreePath} push -u origin feature/merged`.quiet();

    await $`git -C ${repoRoot} worktree add -b feature/open ${openWorktreePath} main`.quiet();
    await Bun.write(join(openWorktreePath, "README.md"), "base\nopen\n");
    await $`git -C ${openWorktreePath} add README.md`.quiet();
    await $`git -C ${openWorktreePath} commit -m open`.quiet();
    await $`git -C ${openWorktreePath} push -u origin feature/open`.quiet();

    await $`git -C ${repoRoot} merge --no-ff feature/merged -m merge-feature-merged`.quiet();
    await $`git -C ${repoRoot} push origin main`.quiet();

    const plan = await planWorktreeCleanup(
      { merged: true },
      repoRoot,
      { includeAllCandidates: true }
    );

    expect(plan.candidates).toHaveLength(2);

    const mergedCandidate = plan.candidates.find(
      (candidate) => candidate.worktree.id === "merged"
    );
    const openCandidate = plan.candidates.find(
      (candidate) => candidate.worktree.id === "open"
    );

    expect(mergedCandidate?.reasons).toEqual(["merged"]);
    expect(openCandidate?.reasons).toEqual([]);
  });
});
