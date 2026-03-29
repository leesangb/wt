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
        binaryPath: "/tmp/wt-bin",
        shellDir,
      });

      expect(result.wrapperPath).toBe(getShellWrapperPath("zsh", shellDir));
      expect(result.sourceLine).toBe(getShellSourceLine("zsh", shellDir));
      expect(readFileSync(result.wrapperPath, "utf-8")).toBe(
        renderShellWrapper("zsh", "/tmp/wt-bin")
      );
    } finally {
      rmSync(shellDir, { recursive: true, force: true });
    }
  });
});
