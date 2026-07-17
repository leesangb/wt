import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getShellSourceLine,
  getShellWrapperPath,
  installShellWrapper,
  refreshExistingShellWrappers,
  renderShellWrapper,
} from "./installer.js";

describe("shell installer", () => {
  test("renders bash wrappers with the embedded binary path", () => {
    const wrapper = renderShellWrapper("bash", "/tmp/wt-bin");

    expect(wrapper).toContain('WT_SHELL_CD_FILE="$cd_file" "/tmp/wt-bin" "$@"');
    expect(wrapper).toContain('local items=$("/tmp/wt-bin" list --completion bash 2>/dev/null)');
  });

  test("installs a wrapper file and returns the matching source line", () => {
    const shellDir = mkdtempSync(join(tmpdir(), "wt-shell-install-"));

    try {
      const result = installShellWrapper({
        shell: "zsh",
        command: "/tmp/wt-bin",
        shellDir,
      });

      expect(result.wrapperPath).toBe(getShellWrapperPath("zsh", shellDir));
      expect(result.sourceLine).toBe(getShellSourceLine("zsh", shellDir));
      const wrapper = readFileSync(result.wrapperPath, "utf-8");

      expect(wrapper).toBe(
        renderShellWrapper("zsh", "/tmp/wt-bin", {
          wrapperPath: result.wrapperPath,
        })
      );
      expect(wrapper).toContain('clean[Bulk-remove worktrees interactively]');
      expect(wrapper).toContain('rename[Rename the current worktree ID]');
    } finally {
      rmSync(shellDir, { recursive: true, force: true });
    }
  });

  test("installed wrappers reload themselves after a successful update", () => {
    const shellDir = mkdtempSync(join(tmpdir(), "wt-shell-reload-"));

    try {
      const result = installShellWrapper({
        shell: "zsh",
        command: "/tmp/wt-bin",
        shellDir,
      });
      const wrapper = readFileSync(result.wrapperPath, "utf-8");

      expect(wrapper).toContain('__wt_wrapper_path="');
      expect(wrapper).toContain('if [ "${1:-}" = "update" ] && [ $exit_code -eq 0 ]');
      expect(wrapper).toContain('source "$__wt_wrapper_path"');
    } finally {
      rmSync(shellDir, { recursive: true, force: true });
    }
  });

  test("permission errors include an ownership repair hint instead of implying sudo install", () => {
    const shellDir = mkdtempSync(join(tmpdir(), "wt-shell-permission-"));
    const error = new Error("permission denied") as NodeJS.ErrnoException;
    error.code = "EACCES";

    try {
      expect(() =>
        installShellWrapper({
          shell: "bash",
          command: "/tmp/wt-bin",
          shellDir,
          writeFile: () => {
            throw error;
          },
        })
      ).toThrow(
        `Could not write wt shell integration in ${shellDir}. This usually means the directory is owned by another user. Run: sudo chown -R "$(id -u):$(id -g)" ~/.wt`
      );
    } finally {
      rmSync(shellDir, { recursive: true, force: true });
    }
  });

  test("renders fish completion helpers with the command kept as one token", () => {
    const wrapper = renderShellWrapper("fish", "/tmp/wt bin");

    expect(wrapper).toContain('function __wt_complete_cd');
    expect(wrapper).toContain('function __wt_complete_pr');
    expect(wrapper).toContain('"/tmp/wt bin" list --completion fish 2>/dev/null');
    expect(wrapper).toContain('"/tmp/wt bin" _complete-pr fish 2>/dev/null');
    expect(wrapper).toContain('complete -c wt -n "__fish_seen_subcommand_from cd" -a "(__wt_complete_cd)" -f');
  });

  test("refreshes only shell wrappers that are already installed", () => {
    const shellDir = mkdtempSync(join(tmpdir(), "wt-shell-refresh-"));
    const calls: Array<{ command: string; args: string[] }> = [];

    try {
      writeFileSync(join(shellDir, "wt.zsh"), "# zsh wrapper\n");
      writeFileSync(join(shellDir, "wt.fish"), "# fish wrapper\n");

      const result = refreshExistingShellWrappers({
        binaryPath: "/tmp/wt-bin",
        shellDir,
        runCommand: (command, args) => {
          calls.push({ command, args });
          return {
            status: 0,
            signal: null,
          };
        },
      });

      expect(result).toEqual({
        refreshedShells: ["zsh", "fish"],
        warnings: [],
      });
      expect(calls).toEqual([
        {
          command: "/tmp/wt-bin",
          args: ["shell", "install", "zsh", "--binary-path", "/tmp/wt-bin"],
        },
        {
          command: "/tmp/wt-bin",
          args: ["shell", "install", "fish", "--binary-path", "/tmp/wt-bin"],
        },
      ]);
    } finally {
      rmSync(shellDir, { recursive: true, force: true });
    }
  });
});
