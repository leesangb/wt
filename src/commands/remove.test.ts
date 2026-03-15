import { describe, expect, test } from "bun:test";
import { resolveWorktreeTarget } from "../domain/worktree-target.js";
import type { WorktreeInfo } from "../types/index.js";

const worktrees: WorktreeInfo[] = [
  {
    id: "abc",
    fullId: "repo-abc",
    path: "/tmp/wt/repo-abc",
    branch: "feature/one",
    repoName: "repo",
    createdAt: "2026-03-14T00:00:00.000Z",
  },
  {
    id: "abcd",
    fullId: "repo-abcd",
    path: "/tmp/wt/repo-abcd",
    branch: "feature/two",
    repoName: "repo",
    createdAt: "2026-03-14T00:00:00.000Z",
  },
];

describe("resolveRemovalTarget", () => {
  test("matches exact identifiers before partial path matches", () => {
    const result = resolveWorktreeTarget(worktrees, "abc", {
      allowPartialPath: true,
    });

    expect(result.worktree?.id).toBe("abc");
    expect(result.error).toBeUndefined();
  });

  test("allows a unique partial path match", () => {
    const result = resolveWorktreeTarget(worktrees, "repo-abcd", {
      allowPartialPath: true,
    });

    expect(result.worktree?.id).toBe("abcd");
  });

  test("fails when a partial path is ambiguous", () => {
    const result = resolveWorktreeTarget(worktrees, "bc", {
      allowPartialPath: true,
    });

    expect(result.worktree).toBeUndefined();
    expect(result.error).toContain('Ambiguous worktree target "bc"');
    expect(result.error).toContain("/tmp/wt/repo-abc");
    expect(result.error).toContain("/tmp/wt/repo-abcd");
  });

  test("returns a not-found error when nothing matches", () => {
    const result = resolveWorktreeTarget(worktrees, "missing", {
      allowPartialPath: true,
    });

    expect(result.worktree).toBeUndefined();
    expect(result.error).toBe('Worktree with target "missing" not found');
  });
});
