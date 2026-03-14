import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { emitShellCd, SHELL_CD_FILE_ENV } from "./cd.js";

const originalEnvValue = process.env[SHELL_CD_FILE_ENV];

afterEach(() => {
  if (originalEnvValue === undefined) {
    delete process.env[SHELL_CD_FILE_ENV];
  } else {
    process.env[SHELL_CD_FILE_ENV] = originalEnvValue;
  }
});

describe("emitShellCd", () => {
  test("writes the target path to the shell cd file when configured", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "wt-cd-test-"));
    const cdFile = join(tempDir, "cd-target");

    process.env[SHELL_CD_FILE_ENV] = cdFile;
    emitShellCd("/tmp/worktree-path");

    expect(readFileSync(cdFile, "utf-8")).toBe("/tmp/worktree-path\n");

    rmSync(tempDir, { recursive: true, force: true });
  });
});
