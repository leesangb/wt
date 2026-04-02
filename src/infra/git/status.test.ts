import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { $ } from "bun";
import { getGoneUpstreamBranchesResult } from "./status.js";

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
  });
});
