import { spawnSync } from "child_process";
import { describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { renderShellWrapper } from "../infra/shell/installer.js";

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

interface RunWrapperOptions {
  overrideCd?: boolean;
  subcommand?: "cd" | "new" | "checkout" | "switch" | "pr" | "rm" | "remove";
  exitCode?: number;
}

interface CompletionRunResult {
  suggestions: string[];
  processStatus: number | null;
  stderr: string;
}

interface ShellProcessResult {
  processStatus: number | null;
  stderr: string;
}

const shellCases = [
  { name: "bash", scriptName: "wt.bash" },
  { name: "zsh", scriptName: "wt.zsh" },
  { name: "fish", scriptName: "wt.fish" },
] satisfies ShellCase[];

const availableShellCases = shellCases.filter(({ name }) => isShellAvailable(name));

function isShellAvailable(shell: ShellName): boolean {
  return spawnSync("sh", ["-lc", `command -v ${shell}`], {
    stdio: "ignore",
  }).status === 0;
}

function runWrapper(
  shellCase: ShellCase,
  targetDir: string,
  options: RunWrapperOptions = {}
): WrapperRunResult {
  const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-wrapper-"));

  try {
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
      renderShellWrapper(shellCase.name, mockWtPath),
      "utf-8"
    );

    const subcommand = options.subcommand ?? "cd";
    const command =
      shellCase.name === "fish"
        ? [
            ...(options.overrideCd ? ["function cd; echo alias-hit; end"] : []),
            'source "$WRAPPER_PATH"',
            `wt ${subcommand} demo >/dev/null 2>/dev/null`,
            "set wrapper_status $status",
            'printf \'STATUS=%s\\nPWD=%s\\n\' "$wrapper_status" "$PWD"',
          ].join("\n")
        : [
            ...(shellCase.name === "zsh"
              ? ["autoload -Uz compinit", "compinit >/dev/null 2>&1"]
              : []),
            ...(shellCase.name === "bash" && options.overrideCd
              ? ["shopt -s expand_aliases"]
              : []),
            ...(options.overrideCd ? ['alias cd="echo alias-hit"'] : []),
            'source "$WRAPPER_PATH"',
            `wt ${subcommand} demo >/dev/null 2>/dev/null`,
            "wrapper_status=$?",
            'printf \'STATUS=%s\\nPWD=%s\\n\' "$wrapper_status" "$PWD"',
          ].join("\n");

    const result = spawnSync(shellCase.name, ["-lc", command], {
      encoding: "utf-8",
      env: {
        ...process.env,
        WRAPPER_PATH: wrapperPath,
        MOCK_TARGET_DIR: targetDir,
        MOCK_EXIT_CODE: String(options.exitCode ?? 0),
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

function runCompletion(
  shellCase: ShellCase,
  subcommand: "cd" | "pr" | "rm" | "remove",
  precedingArgs: string[] = []
): CompletionRunResult {
  const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-completion-"));

  try {
    const mockWtPath = join(tempDir, "mock-wt");
    const wrapperPath = join(tempDir, shellCase.scriptName);

    writeFileSync(
      mockWtPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "list" ] && [ -n "$2" ]; then',
        '  case "$2" in',
        '    --completion)',
        '      if [ "$4" = "--exclude-main-worktree" ]; then',
        '        if [ "$3" = "fish" ]; then',
        '          printf \'%s\\n\' "demo\tDemo branch" "sample\tSample branch"',
        "        else",
        '          printf \'%s\\n\' "demo:Demo branch" "sample:Sample branch"',
        "        fi",
        "      else",
        '      if [ "$3" = "fish" ]; then',
        '        printf \'%s\\n\' "main\tMain branch" "demo\tDemo branch" "sample\tSample branch"',
        "      else",
        '        printf \'%s\\n\' "main:Main branch" "demo:Demo branch" "sample:Sample branch"',
        "      fi",
        "      fi",
        "      ;;",
        "  esac",
        "fi",
        'if [ "$1" = "_complete-pr" ]; then',
        '  if [ "$2" = "fish" ]; then',
        '    printf \'%s\\n\' "142\tFix login | @sangbin | feature/login" "77\tDraft | Update docs | @lee | docs/update"',
        "  else",
        '    printf \'%s\\n\' "142:Fix login | @sangbin | feature/login" "77:Draft | Update docs | @lee | docs/update"',
        "  fi",
        "fi",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    writeFileSync(
      wrapperPath,
      renderShellWrapper(shellCase.name, mockWtPath),
      "utf-8"
    );

    const command =
      shellCase.name === "fish"
        ? [
            'source "$WRAPPER_PATH"',
            `complete --do-complete "wt ${subcommand}${precedingArgs.length > 0 ? ` ${precedingArgs.join(" ")}` : ""} "`,
          ].join("\n")
        : shellCase.name === "bash"
        ? [
            'source "$WRAPPER_PATH"',
            `COMP_WORDS=(wt ${subcommand}${precedingArgs.length > 0 ? ` ${precedingArgs.join(" ")}` : ""} "")`,
            `COMP_CWORD=${precedingArgs.length + 2}`,
            "_wt_completion",
            'printf \'%s\\n\' "${COMPREPLY[@]}"',
          ].join("\n")
        : [
            'source "$WRAPPER_PATH"',
            `typeset -g TEST_SUBCOMMAND=${subcommand}`,
            "function _arguments {",
            "  state=args",
            "  line=($TEST_SUBCOMMAND)",
            "  return 0",
            "}",
            "function _describe {",
            "  local array_name=$2",
            `  eval 'printf "%s\\\\n" "\${'\"$array_name\"'[@]}"'`,
            "}",
            "_wt_completion",
          ].join("\n");

    const result = spawnSync(shellCase.name, ["-lc", command], {
      encoding: "utf-8",
      env: {
        ...process.env,
        WRAPPER_PATH: wrapperPath,
      },
    });

    return {
      suggestions: result.stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split(/[:\t]/, 1)[0]),
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

function assertCompletionProcess(result: ShellProcessResult): void {
  if (result.processStatus !== 0) {
    throw new Error(`Shell exited with ${result.processStatus}:\n${result.stderr}`);
  }
}

describe("shell wrappers", () => {
  for (const shellCase of availableShellCases) {
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

    test(`${shellCase.scriptName} changes directory on pr success`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const targetDir = join(tempDir, "worktree");
        mkdirSync(targetDir, { recursive: true });

        const result = runWrapper(shellCase, targetDir, { subcommand: "pr" });

        assertShellProcess(result);
        expect(result.status).toBe(0);
        expect(result.pwd).toBe(targetDir);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test(`${shellCase.scriptName} changes directory on checkout success`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const targetDir = join(tempDir, "worktree");
        mkdirSync(targetDir, { recursive: true });

        const result = runWrapper(shellCase, targetDir, {
          subcommand: "checkout",
        });

        assertShellProcess(result);
        expect(result.status).toBe(0);
        expect(result.pwd).toBe(targetDir);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test(`${shellCase.scriptName} changes directory on switch success`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const targetDir = join(tempDir, "worktree");
        mkdirSync(targetDir, { recursive: true });

        const result = runWrapper(shellCase, targetDir, {
          subcommand: "switch",
        });

        assertShellProcess(result);
        expect(result.status).toBe(0);
        expect(result.pwd).toBe(targetDir);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test(`${shellCase.scriptName} changes directory on rm success`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const targetDir = join(tempDir, "repo-root");
        mkdirSync(targetDir, { recursive: true });

        const result = runWrapper(shellCase, targetDir, { subcommand: "rm" });

        assertShellProcess(result);
        expect(result.status).toBe(0);
        expect(result.pwd).toBe(targetDir);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test(`${shellCase.scriptName} changes directory on remove success`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const targetDir = join(tempDir, "repo-root");
        mkdirSync(targetDir, { recursive: true });

        const result = runWrapper(shellCase, targetDir, { subcommand: "remove" });

        assertShellProcess(result);
        expect(result.status).toBe(0);
        expect(result.pwd).toBe(targetDir);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test(`${shellCase.scriptName} changes directory on rm nonzero exit when relocation is present`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const targetDir = join(tempDir, "repo-root");
        mkdirSync(targetDir, { recursive: true });

        const result = runWrapper(shellCase, targetDir, {
          subcommand: "rm",
          exitCode: 1,
        });

        assertShellProcess(result);
        expect(result.status).toBe(1);
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

    test(`${shellCase.scriptName} ignores cd overrides in the parent shell`, () => {
      const tempDir = mkdtempSync(join(tmpdir(), "wt-shell-target-"));

      try {
        const targetDir = join(tempDir, "worktree");
        mkdirSync(targetDir, { recursive: true });

        const result = runWrapper(shellCase, targetDir, { overrideCd: true });

        assertShellProcess(result);
        expect(result.status).toBe(0);
        expect(result.pwd).toBe(targetDir);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    test(`${shellCase.scriptName} completes the main worktree for cd`, () => {
      const result = runCompletion(shellCase, "cd");

      assertCompletionProcess(result);
      expect(result.suggestions).toContain("main");
      expect(result.suggestions).toContain("demo");
      expect(result.suggestions).toContain("sample");
    });

    test(`${shellCase.scriptName} completes worktree ids for rm`, () => {
      const result = runCompletion(shellCase, "rm");

      assertCompletionProcess(result);
      expect(result.suggestions).not.toContain("main");
      expect(result.suggestions).toContain("demo");
      expect(result.suggestions).toContain("sample");
    });

    test(`${shellCase.scriptName} completes additional worktree ids for rm`, () => {
      const result = runCompletion(shellCase, "rm", ["demo"]);

      assertCompletionProcess(result);
      expect(result.suggestions).not.toContain("main");
      expect(result.suggestions).toContain("demo");
      expect(result.suggestions).toContain("sample");
    });

    test(`${shellCase.scriptName} completes worktree ids for remove`, () => {
      const result = runCompletion(shellCase, "remove");

      assertCompletionProcess(result);
      expect(result.suggestions).not.toContain("main");
      expect(result.suggestions).toContain("demo");
      expect(result.suggestions).toContain("sample");
    });

    test(`${shellCase.scriptName} completes open pull request numbers for pr`, () => {
      const result = runCompletion(shellCase, "pr");

      assertCompletionProcess(result);
      expect(result.suggestions).toContain("142");
      expect(result.suggestions).toContain("77");
    });
  }
});
