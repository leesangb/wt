import { describe, expect, test } from "bun:test";
import {
  buildWorktreeIdentifiers,
  buildWorktreePathName,
  createWorktreeMeta,
  toWorktreePathSegment,
} from "./worktree.js";

describe("worktree domain", () => {
  test("replaces slashes when building a worktree path segment", () => {
    expect(toWorktreePathSegment("feature/issue-12")).toBe("feature-issue-12");
  });

  test("builds a repo-prefixed path name from the stored id", () => {
    expect(buildWorktreePathName("repo", "feature/issue-12")).toBe(
      "repo-feature-issue-12"
    );
  });

  test("prefers stored identifiers over the worktree path basename", () => {
    const meta = createWorktreeMeta(
      "main",
      "abc123",
      "2026-03-16T00:00:00.000Z",
      {
        id: "feature/issue-12",
        fullId: "repo-feature/issue-12",
      }
    );

    expect(
      buildWorktreeIdentifiers("repo", "/tmp/wt/repo-feature-issue-12", meta)
    ).toEqual({
      id: "feature/issue-12",
      fullId: "repo-feature/issue-12",
    });
  });

  test("falls back to deriving identifiers from the path for legacy worktrees", () => {
    expect(buildWorktreeIdentifiers("repo", "/tmp/wt/repo-legacy-id")).toEqual({
      id: "legacy-id",
      fullId: "repo-legacy-id",
    });
  });
});
