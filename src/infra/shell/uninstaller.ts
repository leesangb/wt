import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import type { SupportedShell } from "../../domain/shell.js";

export interface RemovedShellConfig {
  path: string;
  shell: SupportedShell;
}

export interface RemoveShellIntegrationOptions {
  homeDir?: string;
  shellDir?: string;
}

export interface RemoveShellIntegrationResult {
  shellDir: string;
  shellDirRemoved: boolean;
  updatedShellConfigs: RemovedShellConfig[];
  warnings: string[];
}

function getShellConfigPath(shell: SupportedShell, homeDir: string): string {
  switch (shell) {
    case "bash":
      return join(homeDir, ".bashrc");
    case "zsh":
      return join(homeDir, ".zshrc");
    case "fish":
      return join(homeDir, ".config", "fish", "config.fish");
  }
}

function removeShellSourceLine(content: string, shell: SupportedShell): {
  updated: boolean;
  nextContent: string;
} {
  const normalized = content.replaceAll("\r\n", "\n");
  const hadTrailingNewline = normalized.endsWith("\n");
  const lines = normalized.split("\n");

  if (hadTrailingNewline) {
    lines.pop();
  }

  const sourcePattern = new RegExp(`source.*\\.wt/shell/wt\\.${shell}`);
  const nextLines = lines.filter((line) => !sourcePattern.test(line));

  if (nextLines.length === lines.length) {
    return {
      updated: false,
      nextContent: content,
    };
  }

  if (nextLines.length === 0) {
    return {
      updated: true,
      nextContent: "",
    };
  }

  return {
    updated: true,
    nextContent: `${nextLines.join("\n")}${hadTrailingNewline ? "\n" : ""}`,
  };
}

export function removeShellIntegration(
  options: RemoveShellIntegrationOptions = {}
): RemoveShellIntegrationResult {
  const homeDir = options.homeDir ?? homedir();
  const shellDir = options.shellDir ?? join(homeDir, ".wt", "shell");
  const warnings: string[] = [];
  const updatedShellConfigs: RemovedShellConfig[] = [];
  let shellDirRemoved = false;

  if (existsSync(shellDir)) {
    try {
      rmSync(shellDir, { recursive: true, force: true });
      shellDirRemoved = true;
    } catch (error) {
      warnings.push(
        `Could not remove shell wrapper directory ${shellDir}: ${error}`
      );
    }
  }

  for (const shell of ["zsh", "bash", "fish"] as const) {
    const configPath = getShellConfigPath(shell, homeDir);

    if (!existsSync(configPath)) {
      continue;
    }

    try {
      const result = removeShellSourceLine(
        readFileSync(configPath, "utf-8"),
        shell
      );

      if (!result.updated) {
        continue;
      }

      writeFileSync(configPath, result.nextContent, "utf-8");
      updatedShellConfigs.push({
        path: configPath,
        shell,
      });
    } catch (error) {
      warnings.push(`Could not update shell config ${configPath}: ${error}`);
    }
  }

  return {
    shellDir,
    shellDirRemoved,
    updatedShellConfigs,
    warnings,
  };
}
