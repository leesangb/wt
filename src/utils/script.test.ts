import { afterEach, describe, expect, test } from "bun:test";
import { SHELL_CD_FILE_ENV } from "./cd.js";
import {
  buildDetachedRunnerCommand,
  buildScriptEnv,
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
