import { describe, expect, test } from "bun:test";
import { buildDetachedRunnerCommand, shellEscapeSingle } from "./script.js";

describe("shellEscapeSingle", () => {
  test("escapes single quotes for shell-safe single-quoted strings", () => {
    expect(shellEscapeSingle("a'b'c")).toBe("a'\"'\"'b'\"'\"'c");
  });
});

describe("buildDetachedRunnerCommand", () => {
  test("includes scripts, log path, and status path", () => {
    const cmd = buildDetachedRunnerCommand({
      scripts: ["pnpm install", "pnpm build"],
      statusFilePath: "/tmp/post-task.json",
      logFilePath: "/tmp/post-task.log",
    });

    expect(cmd).toContain("pnpm install");
    expect(cmd).toContain("pnpm build");
    expect(cmd).toContain("/tmp/post-task.log");
    expect(cmd).toContain("/tmp/post-task.json");
    expect(cmd).toContain('"status":"done"');
    expect(cmd).toContain('"status":"failed"');
  });
});
