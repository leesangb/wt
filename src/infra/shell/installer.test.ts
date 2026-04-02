import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getShellSourceLine,
  getShellWrapperPath,
  installShellWrapper,
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

      expect(wrapper).toBe(renderShellWrapper("zsh", "/tmp/wt-bin"));
      expect(wrapper).toContain('clean[Bulk-remove worktrees by filter]');
    } finally {
      rmSync(shellDir, { recursive: true, force: true });
    }
  });

  test("renders fish completion helpers with the command kept as one token", () => {
    const wrapper = renderShellWrapper("fish", "/tmp/wt bin");

    expect(wrapper).toContain('function __wt_complete_cd');
    expect(wrapper).toContain('"/tmp/wt bin" list --completion fish 2>/dev/null');
    expect(wrapper).toContain('complete -c wt -n "__fish_seen_subcommand_from cd" -a "(__wt_complete_cd)" -f');
  });
});
