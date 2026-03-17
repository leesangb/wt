import { afterEach, describe, expect, test } from "bun:test";
import { SHELL_CD_FILE_ENV } from "./cd.js";
import {
  buildDetachedRunnerCommand,
  buildPostScriptCompletionNotification,
  buildScriptEnv,
  escapeAppleScriptString,
  shellEscapeSingle,
} from "./script.js";

const originalShellCdFileEnv = process.env[SHELL_CD_FILE_ENV];

afterEach(() => {
  if (originalShellCdFileEnv === undefined) {
    delete process.env[SHELL_CD_FILE_ENV];
  } else {
    process.env[SHELL_CD_FILE_ENV] = originalShellCdFileEnv;
  }
});

describe("shellEscapeSingle", () => {
  test("escapes single quotes for shell-safe single-quoted strings", () => {
    expect(shellEscapeSingle("a'b'c")).toBe("a'\"'\"'b'\"'\"'c");
  });
});

describe("escapeAppleScriptString", () => {
  test("escapes double quotes and backslashes for AppleScript string literals", () => {
    expect(escapeAppleScriptString('a\\"b\\c')).toBe('a\\\\\\"b\\\\c');
  });
});

describe("buildPostScriptCompletionNotification", () => {
  test("builds success and failure messages with branch context", () => {
    expect(buildPostScriptCompletionNotification("feature/foo")).toEqual({
      title: "wt",
      successMessage: "feature/foo setup finished",
      successSubtitle: "Post scripts completed",
      failureMessage: "feature/foo setup failed",
      failureSubtitle: "Post scripts failed",
    });
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

  test("includes macOS notifications when provided", () => {
    const cmd = buildDetachedRunnerCommand({
      scripts: ["pnpm install"],
      statusFilePath: "/tmp/post-task.json",
      logFilePath: "/tmp/post-task.log",
      completionNotification: buildPostScriptCompletionNotification(
        `feature/o'hare "beta"`
      ),
    });

    expect(cmd).toContain("osascript -e");
    expect(cmd).toContain("feature/o");
    expect(cmd).toContain("setup finished");
    expect(cmd).toContain("setup failed");
    expect(cmd).toContain('Post scripts completed');
    expect(cmd).toContain('Post scripts failed');
    expect(cmd).toContain(">/dev/null 2>&1 || true");
  });
});

describe("buildScriptEnv", () => {
  test("omits the parent shell cd file from child script environments", () => {
    process.env[SHELL_CD_FILE_ENV] = "/tmp/parent-shell-cd";

    const env = buildScriptEnv({
      WT_PATH: "/tmp/worktree",
      [SHELL_CD_FILE_ENV]: "/tmp/nested-shell-cd",
    });

    expect(env[SHELL_CD_FILE_ENV]).toBeUndefined();
    expect(env.WT_PATH).toBe("/tmp/worktree");
  });
});
