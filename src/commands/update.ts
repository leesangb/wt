import chalk from "chalk";
import { runCommand } from "../cli/command-runtime.js";
import { runWithSpinner } from "../cli/spinner.js";
import {
  getUpdateStrategy,
  updateInstallation,
  type UpdateInstallationOptions,
  type UpdateInstallationResult,
} from "../app/use-cases/update-installation.js";

function buildUpdateSpinnerText(options: UpdateInstallationOptions): string {
  const targetVersion = options.version?.replace(/^v/, "");

  if (targetVersion) {
    return `Updating wt to version ${targetVersion}`;
  }

  return "Checking for wt updates";
}

function printShellIntegrationRefresh(result: UpdateInstallationResult): void {
  const shellIntegration = result.shellIntegration;

  if (!shellIntegration) {
    return;
  }

  if (shellIntegration.refreshedShells.length > 0) {
    console.log(
      chalk.dim(
        `Refreshed shell integration for ${shellIntegration.refreshedShells.join(", ")}.`
      )
    );
  }

  for (const warning of shellIntegration.warnings) {
    console.log(chalk.yellow(`Warning: ${warning}`));
  }
}

export async function updateCommand(
  options: UpdateInstallationOptions
): Promise<void> {
  await runCommand(async () => {
    const currentVersion = (await import("../../package.json")).default
      .version as string;
    const strategy = getUpdateStrategy();

    if (strategy === "homebrew") {
      const result = await updateInstallation(currentVersion, options, {
        onBeforeHomebrewUpdate: (command) => {
          console.log(
            chalk.dim(`Homebrew installation detected. Running: ${command}`)
          );
        },
      });
      printShellIntegrationRefresh(result);
      return;
    }

    const result = await runWithSpinner(
      buildUpdateSpinnerText(options),
      () => updateInstallation(currentVersion, options)
    );

    if (result.strategy !== "standalone") {
      return;
    }

    if (!result.updated) {
      if (result.targetVersion && result.targetVersion !== currentVersion) {
        console.log(
          chalk.yellow(
            `Target version (${result.targetVersion}) is not newer than current (${currentVersion}). Use --force to overwrite.`
          )
        );
      } else {
        console.log(
          chalk.green(
            `wt is up to date (current ${currentVersion}, latest ${result.targetVersion ?? currentVersion}).`
          )
        );
        console.log(chalk.dim("Use --force to re-download the current version."));
      }
      return;
    }

    console.log(chalk.green(`✓ Updated wt to version ${result.targetVersion}`));
    printShellIntegrationRefresh(result);
    console.log(chalk.dim("Run: wt --version to verify."));
  });
}
