import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { $ } from "bun";
import {
  createWorktreeRemovalStatusReader,
  getGoneUpstreamBranchesResult,
  getWorktreeRemovalStatusSummary,
} from "./status.js";

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

describe("getGoneUpstreamBranchesResult", () => {
  test("handles valid branch names that contain pipe characters", async () => {
    const originDir = makeTempDir("wt-origin-");
    const repoRoot = makeTempDir("wt-repo-");

    await $`git init --bare ${originDir}`.quiet();
    await $`git clone ${originDir} ${repoRoot}`.quiet();
    await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
    await $`git -C ${repoRoot} config user.name tester`.quiet();
    await $`git -C ${repoRoot} checkout -b main`.quiet();
    await Bun.write(join(repoRoot, "README.md"), "base\n");
    await $`git -C ${repoRoot} add README.md`.quiet();
    await $`git -C ${repoRoot} commit -m base`.quiet();
    await $`git -C ${repoRoot} push -u origin main`.quiet();
    await $`git -C ${repoRoot} checkout -b ${"feature|gone"}`.quiet();
    await $`git -C ${repoRoot} push -u origin ${"feature|gone"}`.quiet();
    await $`git -C ${repoRoot} push origin --delete ${"feature|gone"}`.quiet();
    await $`git -C ${repoRoot} fetch --prune origin`.quiet();

    const result = await getGoneUpstreamBranchesResult(repoRoot);

    expect(result.known).toBeTrue();
    expect(result.branches.has("feature|gone")).toBeTrue();
    const scoped = await getGoneUpstreamBranchesResult(repoRoot, ["main"]);
    expect(scoped.known).toBeTrue();
    expect(scoped.branches.size).toBe(0);
  });
});

test("removal preview snapshots keep file status fresh and do not affect a new inspection", async () => {
  const repoRoot = makeTempDir("wt-removal-snapshot-");
  await $`git init -b main ${repoRoot}`.quiet();
  await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
  await $`git -C ${repoRoot} config user.name tester`.quiet();
  await $`git -C ${repoRoot} -c commit.gpgsign=false commit --allow-empty -m base`.quiet();
  await $`git -C ${repoRoot} update-ref refs/remotes/origin/main HEAD`.quiet();
  const readPreview = createWorktreeRemovalStatusReader(repoRoot, ["main"]);

  expect(await readPreview(repoRoot, "main")).toEqual({
    localCommitCount: 0, localChangeCount: 0, hasUnknownLocalCommits: false,
  });
  await Bun.write(join(repoRoot, "pending"), "local change");
  expect(await readPreview(repoRoot, "main")).toEqual({
    localCommitCount: 0, localChangeCount: 1, hasUnknownLocalCommits: false,
  });
  await $`git -C ${repoRoot} -c commit.gpgsign=false commit --allow-empty -m ahead`.quiet();

  expect(await getWorktreeRemovalStatusSummary(repoRoot, repoRoot, "main")).toEqual({
    localCommitCount: 1, localChangeCount: 1, hasUnknownLocalCommits: false,
  });
  const nextPreview = createWorktreeRemovalStatusReader(repoRoot, ["main"]);
  expect(await nextPreview(repoRoot, "main")).toEqual({
    localCommitCount: 1, localChangeCount: 1, hasUnknownLocalCommits: false,
  });
});

test("removal preview preserves missing-origin fallback, divergence and short ref collisions", async () => {
  const repoRoot = makeTempDir("wt-removal-fallback-");
  await $`git init -b main ${repoRoot}`.quiet();
  await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
  await $`git -C ${repoRoot} config user.name tester`.quiet();
  await $`git -C ${repoRoot} -c commit.gpgsign=false commit --allow-empty -m base`.quiet();
  await $`git -C ${repoRoot} update-ref refs/remotes/origin/main HEAD`.quiet();
  await $`git -C ${repoRoot} symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main`.quiet();
  await $`git -C ${repoRoot} checkout -b local`.quiet();
  await $`git -C ${repoRoot} -c commit.gpgsign=false commit --allow-empty -m local`.quiet();
  await $`git -C ${repoRoot} update-ref refs/remotes/origin/diverged HEAD`.quiet();
  await $`git -C ${repoRoot} tag equal HEAD`.quiet();
  await $`git -C ${repoRoot} checkout -b diverged main`.quiet();
  await $`git -C ${repoRoot} -c commit.gpgsign=false commit --allow-empty -m diverged`.quiet();
  await $`git -C ${repoRoot} branch equal main`.quiet();
  await $`git -C ${repoRoot} update-ref refs/remotes/origin/equal main`.quiet();
  const readPreview = createWorktreeRemovalStatusReader(repoRoot, ["local", "diverged", "equal"]);

  for (const branch of ["local", "diverged", "equal"]) {
    expect(await readPreview(repoRoot, branch, "main")).toEqual({
      localCommitCount: 1, localChangeCount: 0, hasUnknownLocalCommits: false,
    });
  }
  expect(await readPreview(repoRoot)).toEqual({
    localCommitCount: 0, localChangeCount: 0, hasUnknownLocalCommits: true,
  });
  expect(await readPreview(repoRoot, "missing", "missing")).toEqual({
    localCommitCount: 0, localChangeCount: 0, hasUnknownLocalCommits: true,
  });
});
