import { spawnSync } from "child_process";
import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

type ShellName = "bash" | "zsh" | "fish";

interface ShellCase {
  name: ShellName;
  scriptName: string;
}

interface WrapperRunResult {
  status: number;
  pwd: string;
  processStatus: number | null;
  stderr: string;
}

const shellDir = fileURLToPath(new URL("../../shell/", import.meta.url));
const shellCases: ShellCase[] = [
  { name: "bash", scriptName: "wt.bash" },
  { name: "zsh", scriptName: "wt.zsh" },
  { name: "fish", scriptName: "wt.fish" },
].filter(({ name }) => isShellAvailable(name));

function isShellAvailable(shell: ShellName): boolean {
  return spawnSync("sh", ["-lc", `command -v ${shell}`], {
    stdio: "ignore",
  }).status === 0;
}

function runWrapper(shellCase: ShellCase, targetDir: string): WrapperRunResult {
  const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-wrapper-"));

  try {
    const wrapperTemplate = readFileSync(
      join(shellDir, shellCase.scriptName),
      "utf-8"
    );
    const mockWtPath = join(tempDir, "mock-wt");
    const wrapperPath = join(tempDir, shellCase.scriptName);

    writeFileSync(
      mockWtPath,
      [
        "#!/bin/sh",
        'if [ -n "$WT_SHELL_CD_FILE" ]; then',
        '  printf \'%s\\n\' "$MOCK_TARGET_DIR" > "$WT_SHELL_CD_FILE"',
        "fi",
        'exit "${MOCK_EXIT_CODE:-0}"',
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    writeFileSync(
      wrapperPath,
      wrapperTemplate.replaceAll("/path/to/wt", mockWtPath),
      "utf-8"
    );

    const command =
      shellCase.name === "fish"
        ? [
            'source "$WRAPPER_PATH"',
            "wt cd demo >/dev/null 2>/dev/null",
            "set wrapper_status $status",
            'printf \'STATUS=%s\\nPWD=%s\\n\' "$wrapper_status" "$PWD"',
          ].join("\n")
        : [
            ...(shellCase.name === "zsh"
              ? ["autoload -Uz compinit", "compinit >/dev/null 2>&1"]
              : []),
            'source "$WRAPPER_PATH"',
            "wt cd demo >/dev/null 2>/dev/null",
            "wrapper_status=$?",
            'printf \'STATUS=%s\\nPWD=%s\\n\' "$wrapper_status" "$PWD"',
          ].join("\n");

    const result = spawnSync(shellCase.name, ["-lc", command], {
      encoding: "utf-8",
      env: {
        ...process.env,
        WRAPPER_PATH: wrapperPath,
        MOCK_TARGET_DIR: targetDir,
        MOCK_EXIT_CODE: "0",
      },
    });

    return {
      status: Number(readOutputValue(result.stdout, "STATUS")),
      pwd: readOutputValue(result.stdout, "PWD"),
      processStatus: result.status,
      stderr: result.stderr,
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function readOutputValue(stdout: string, key: string): string {
  const line = stdout.split(/\r?\n/).find(entry => entry.startsWith(`${key}=`));

  if (!line) {
    throw new Error(`Missing ${key} in shell output:\n${stdout}`);
  }

  return line.slice(key.length + 1);
}

function assertShellProcess(result: WrapperRunResult): void {
  if (result.processStatus !== 0) {
    throw new Error(`Shell exited with ${result.processStatus}:\n${result.stderr}`);
  }
}

describe("shell wrappers", () => {
  for (const shellCase of shellCases) {
    test(`${shellCase.scriptName} changes directory on success`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const targetDir = join(tempDir, "worktree");
        mkdirSync(targetDir, { recursive: true });

        const result = runWrapper(shellCase, targetDir);

        assertShellProcess(result);
        expect(result.status).toBe(0);
        expect(result.pwd).toBe(targetDir);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test(`${shellCase.scriptName} returns nonzero when cd fails`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const missingDir = join(tempDir, "missing-worktree");
        const result = runWrapper(shellCase, missingDir);

        assertShellProcess(result);
        expect(result.status).not.toBe(0);
        expect(result.pwd).not.toBe(missingDir);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  }
});
