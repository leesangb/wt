import chalk from "chalk";
import { runCommand } from "../cli/command-runtime.js";
import { runWithSpinner } from "../cli/spinner.js";
import { updateInstallation } from "../app/use-cases/update-installation.js";

interface UpdateOptions {
  force?: boolean;
  version?: string;
  removeQuarantine?: boolean;
}

function buildUpdateSpinnerText(options: UpdateOptions): string {
  const targetVersion = options.version?.replace(/^v/, "");

  if (targetVersion) {
    return `Updating wt to version ${targetVersion}`;
  }

  return "Checking for wt updates";
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  await runCommand(async () => {
    const currentVersion = (await import("../../package.json")).default
      .version as string;
    const result = await runWithSpinner(
      buildUpdateSpinnerText(options),
      () => updateInstallation(currentVersion, options)
    );

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

    if (result.shellScriptsSkipped) {
      console.log(
        chalk.yellow(
          "Shell integration directory not found. Skipping shell integration update."
        )
      );
    } else if (
      result.shellScriptsUpdated.length > 0 ||
      result.shellScriptWarnings.length > 0
    ) {
      console.log(chalk.blue("Shell integration update results:"));
      for (const scriptName of result.shellScriptsUpdated) {
        console.log(chalk.green(`✓ Updated ${scriptName}`));
      }
      for (const warning of result.shellScriptWarnings) {
        console.log(chalk.yellow(warning));
      }

      if (result.shellScriptsUpdated.length > 0) {
        console.log(
          chalk.green(
            `✓ Updated ${result.shellScriptsUpdated.length} shell integration script(s)`
          )
        );
        console.log(
          chalk.yellow(
            "Note: Restart your shell or source your config file to apply changes."
          )
        );
      }
    }

    console.log(chalk.dim("Run: wt --version to verify."));
  });
}
