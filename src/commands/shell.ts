import chalk from "chalk";
import { homedir } from "os";
import { join, sep } from "path";
import { runCommand } from "../cli/command-runtime.js";
import { installShellIntegration } from "../app/use-cases/install-shell-integration.js";
import type { SupportedShell } from "../domain/shell.js";

interface ShellInstallOptions {
  binaryPath?: string;
}

function shellSingleQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

function formatDisplayPath(path: string): string {
  const homePath = homedir();

  if (path === homePath) {
    return "~";
  }

  if (path.startsWith(`${homePath}${sep}`)) {
    return `~${path.slice(homePath.length).split(sep).join("/")}`;
  }

  return path;
}

function getShellConfigPath(shell: SupportedShell): string {
  const homePath = homedir();

  switch (shell) {
    case "bash":
      return join(homePath, ".bashrc");
    case "zsh":
      return join(homePath, ".zshrc");
    case "fish":
      return join(homePath, ".config", "fish", "config.fish");
  }
}

function formatShellSourceLine(wrapperPath: string): string {
  const displayWrapperPath = formatDisplayPath(wrapperPath);

  if (displayWrapperPath.startsWith("~")) {
    return `source ${displayWrapperPath}`;
  }

  return `source "${wrapperPath}"`;
}

function formatAppendCommand(
  shell: SupportedShell,
  sourceLine: string
): string {
  const displayConfigPath = formatDisplayPath(getShellConfigPath(shell));
  const redirectTarget = displayConfigPath.startsWith("~")
    ? displayConfigPath
    : shellSingleQuote(displayConfigPath);

  if (!sourceLine.includes("'") && !sourceLine.includes("%")) {
    return `printf '\\n${sourceLine}\\n' >> ${redirectTarget}`;
  }

  return `printf '\\n%s\\n' ${shellSingleQuote(sourceLine)} >> ${redirectTarget}`;
}

export async function shellInstallCommand(
  shell: string,
  options: ShellInstallOptions
): Promise<void> {
  await runCommand(async () => {
    const result = installShellIntegration({
      shell,
      binaryPath: options.binaryPath,
    });
    const displayWrapperPath = formatDisplayPath(result.wrapperPath);
    const sourceLine = formatShellSourceLine(result.wrapperPath);
    const appendCommand = formatAppendCommand(result.shell, sourceLine);

    console.log(
      chalk.green(
        `✓ Installed ${result.shell} shell integration at ${displayWrapperPath}`
      )
    );
    console.log(chalk.dim("Run this to append it to your shell config:"));
    console.log(chalk.cyan(`  ${appendCommand}`));
  });
}
