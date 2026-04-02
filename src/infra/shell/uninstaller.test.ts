import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { removeShellIntegration } from "./uninstaller.js";

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("shell uninstaller", () => {
  test("removes default shell wrappers and source lines", () => {
    const homeDir = makeTempDir("wt-shell-uninstall-");
    const shellDir = join(homeDir, ".wt", "shell");
    const zshrcPath = join(homeDir, ".zshrc");
    const bashrcPath = join(homeDir, ".bashrc");
    const fishConfigPath = join(homeDir, ".config", "fish", "config.fish");

    mkdirSync(join(homeDir, ".config", "fish"), { recursive: true });
    mkdirSync(shellDir, { recursive: true });
    writeFileSync(join(shellDir, "wt.zsh"), "# zsh wrapper\n");
    writeFileSync(join(shellDir, "wt.bash"), "# bash wrapper\n");
    writeFileSync(join(shellDir, "wt.fish"), "# fish wrapper\n");
    writeFileSync(
      zshrcPath,
      ['export PATH="$PATH:$HOME/.local/bin"', 'source "~/.wt/shell/wt.zsh"'].join("\n")
    );
    writeFileSync(
      bashrcPath,
      ['alias ll="ls -la"', 'source "/tmp/test/.wt/shell/wt.bash"'].join("\n")
    );
    writeFileSync(
      fishConfigPath,
      ['set -gx PATH $PATH ~/.local/bin', 'source ~/.wt/shell/wt.fish'].join("\n")
    );

    try {
      const result = removeShellIntegration({ homeDir });

      expect(result.shellDirRemoved).toBe(true);
      expect(result.updatedShellConfigs).toEqual([
        { path: zshrcPath, shell: "zsh" },
        { path: bashrcPath, shell: "bash" },
        { path: fishConfigPath, shell: "fish" },
      ]);
      expect(result.warnings).toEqual([]);
      expect(existsSync(shellDir)).toBe(false);
      expect(readFileSync(zshrcPath, "utf-8")).toBe('export PATH="$PATH:$HOME/.local/bin"');
      expect(readFileSync(bashrcPath, "utf-8")).toBe('alias ll="ls -la"');
      expect(readFileSync(fishConfigPath, "utf-8")).toBe(
        "set -gx PATH $PATH ~/.local/bin"
      );
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });

  test("clears a config file when the wrapper source line is the only line", () => {
    const homeDir = makeTempDir("wt-shell-uninstall-empty-");
    const zshrcPath = join(homeDir, ".zshrc");

    writeFileSync(zshrcPath, 'source "/tmp/test/.wt/shell/wt.zsh"\n');

    try {
      const result = removeShellIntegration({ homeDir });

      expect(result.updatedShellConfigs).toEqual([
        { path: zshrcPath, shell: "zsh" },
      ]);
      expect(readFileSync(zshrcPath, "utf-8")).toBe("");
    } finally {
      rmSync(homeDir, { recursive: true, force: true });
    }
  });
});
