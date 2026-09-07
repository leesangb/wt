import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { $ } from "bun";
import {
  ensureRemoveTaskArtifactsExcluded,
  ensureWtLocalFilesExcluded,
  LOCAL_SETTINGS_EXCLUDE_ENTRY,
  REMOVE_TASK_EXCLUDE_ENTRIES,
} from "./exclude.js";

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

describe("git exclude", () => {
  test("adds wt local files without replacing existing entries", async () => {
    const repoRoot = makeTempDir("wt-git-exclude-");

    await $`git init ${repoRoot}`.quiet();
    const excludePath = join(repoRoot, ".git", "info", "exclude");
    writeFileSync(excludePath, "*.local\n");

    await expect(ensureWtLocalFilesExcluded(repoRoot)).resolves.toBe(true);
    expect(readFileSync(excludePath, "utf-8")).toBe(
      [
        "*.local",
        LOCAL_SETTINGS_EXCLUDE_ENTRY,
        ...REMOVE_TASK_EXCLUDE_ENTRIES,
        "",
      ].join("\n")
    );
    await expect(ensureWtLocalFilesExcluded(repoRoot)).resolves.toBe(false);
  });

  test("recognizes root-anchored equivalents without duplicating them", async () => {
    const repoRoot = makeTempDir("wt-git-exclude-");

    await $`git init ${repoRoot}`.quiet();
    const excludePath = join(repoRoot, ".git", "info", "exclude");
    writeFileSync(
      excludePath,
      REMOVE_TASK_EXCLUDE_ENTRIES.map((entry) => `/${entry}`).join("\n") + "\n"
    );

    await expect(ensureRemoveTaskArtifactsExcluded(repoRoot)).resolves.toBe(
      false
    );
  });

  test("updates the common exclude file from a linked worktree", async () => {
    const root = makeTempDir("wt-git-exclude-linked-");
    const repoRoot = join(root, "repo");
    const linkedWorktree = join(root, "linked");

    mkdirSync(repoRoot, { recursive: true });
    await $`git init ${repoRoot}`.quiet();
    await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
    await $`git -C ${repoRoot} config user.name tester`.quiet();
    writeFileSync(join(repoRoot, "README.md"), "base\n");
    await $`git -C ${repoRoot} add README.md`.quiet();
    await $`git -C ${repoRoot} commit -m base`.quiet();
    await $`git -C ${repoRoot} worktree add -b feature ${linkedWorktree}`.quiet();

    await expect(ensureWtLocalFilesExcluded(linkedWorktree)).resolves.toBe(true);
    expect(
      readFileSync(join(repoRoot, ".git", "info", "exclude"), "utf-8")
    ).toContain(LOCAL_SETTINGS_EXCLUDE_ENTRY);
  });
});
