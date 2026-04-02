import chalk from "chalk";
import { homedir } from "os";
import { sep } from "path";
import { runCommand } from "../cli/command-runtime.js";
import { uninstallInstallation } from "../app/use-cases/uninstall-installation.js";

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

function buildReloadCommand(path: string): string | undefined {
  if (path.endsWith(".zshrc")) {
    return "source ~/.zshrc";
  }

  if (path.endsWith(".bashrc")) {
    return "source ~/.bashrc";
  }

  if (path.endsWith("config.fish")) {
    return "source ~/.config/fish/config.fish";
  }

  return undefined;
}

export async function uninstallCommand(): Promise<void> {
  await runCommand(async () => {
    const result = uninstallInstallation({
      onBeforeHomebrewUninstall: (command) => {
        console.log(
          chalk.dim(`Homebrew installation detected. Running: ${command}`)
        );
      },
    });

    if (result.strategy === "homebrew") {
      console.log(chalk.green("✓ Uninstalled wt via Homebrew"));
    } else {
      console.log(
        chalk.green(
          `✓ Removed standalone wt binary at ${formatDisplayPath(result.binaryPath)}`
        )
      );
    }

    if (result.shellIntegration.shellDirRemoved) {
      console.log(
        chalk.green(
          `✓ Removed shell wrappers from ${formatDisplayPath(
            result.shellIntegration.shellDir
          )}`
        )
      );
    }

    if (result.shellIntegration.updatedShellConfigs.length > 0) {
      console.log(chalk.green("✓ Removed shell wrapper source lines"));

      const reloadCommands = result.shellIntegration.updatedShellConfigs
        .map((config) => buildReloadCommand(config.path))
        .filter((value): value is string => Boolean(value));

      if (reloadCommands.length > 0) {
        console.log(chalk.dim("Restart your shell or run:"));
        for (const command of reloadCommands) {
          console.log(chalk.cyan(`  ${command}`));
        }
      }
    }

    if (result.shellIntegration.warnings.length > 0) {
      for (const warning of result.shellIntegration.warnings) {
        console.log(chalk.yellow(`Warning: ${warning}`));
      }
    }

    console.log(
      chalk.dim(
        "Worktrees under ~/.wt/ and repository .wt/settings.json / .wt/settings.local.json were not removed."
      )
    );
  });
}
