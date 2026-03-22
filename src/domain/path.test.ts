import { describe, expect, test } from "bun:test";
import { isPathInside } from "./path.js";

describe("isPathInside", () => {
  test("returns true for nested POSIX paths", () => {
    expect(isPathInside("/repo/worktree", "/repo/worktree/src")).toBeTrue();
  });

  test("returns false for sibling POSIX paths", () => {
    expect(isPathInside("/repo/worktree", "/repo/other")).toBeFalse();
  });

  test("returns true for nested Windows paths on the same drive", () => {
    expect(isPathInside("D:\\repo\\worktree", "D:\\repo\\worktree\\src")).toBeTrue();
  });

  test("returns false for Windows paths on different drives", () => {
    expect(isPathInside("D:\\repo\\worktree", "C:\\repo\\worktree\\src")).toBeFalse();
  });
});
