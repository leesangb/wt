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
import {
  WORKTREE_GITIGNORE_CONTENT,
  readWorktreeMeta,
  writeWorktreeMeta,
} from "./worktree-meta-store.js";

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

describe("worktree meta store", () => {
  test("writes meta.json and the matching gitignore entry", async () => {
    const worktreePath = makeTempDir("wt-meta-store-");

    await writeWorktreeMeta(worktreePath, {
      baseBranch: "main",
      baseCommit: "abc123",
      createdAt: "2026-03-15T00:00:00.000Z",
      id: "feature/issue-12",
      fullId: "repo-feature/issue-12",
    });

    expect(
      JSON.parse(
        readFileSync(join(worktreePath, ".wt", "meta.json"), "utf-8")
      )
    ).toEqual({
      baseBranch: "main",
      baseCommit: "abc123",
      createdAt: "2026-03-15T00:00:00.000Z",
      id: "feature/issue-12",
      fullId: "repo-feature/issue-12",
    });
    expect(
      readFileSync(join(worktreePath, ".wt", ".gitignore"), "utf-8")
    ).toBe(WORKTREE_GITIGNORE_CONTENT);
  });

  test("reads the legacy meta file for backwards compatibility", async () => {
    const worktreePath = makeTempDir("wt-meta-store-");
    const wtDir = join(worktreePath, ".wt");

    mkdirSync(wtDir, { recursive: true });
    writeFileSync(
      join(wtDir, "meta"),
      JSON.stringify({
        baseBranch: "trunk",
        baseCommit: "def456",
        createdAt: "2026-03-15T01:00:00.000Z",
      })
    );

    expect(await readWorktreeMeta(worktreePath)).toEqual({
      baseBranch: "trunk",
      baseCommit: "def456",
      createdAt: "2026-03-15T01:00:00.000Z",
    });
  });
});
