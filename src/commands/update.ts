import chalk from "chalk";
import { runCommand } from "../cli/command-runtime.js";
import { runWithSpinner } from "../cli/spinner.js";
import {
  updateInstallation,
  type UpdateInstallationOptions,
} from "../app/use-cases/update-installation.js";
import {
  buildHomebrewUpdatePlan,
  isHomebrewManagedInstallation,
  runHomebrewUpdate,
} from "../infra/update/homebrew.js";

function buildUpdateSpinnerText(options: UpdateInstallationOptions): string {
  const targetVersion = options.version?.replace(/^v/, "");

  if (targetVersion) {
    return `Updating wt to version ${targetVersion}`;
  }

  return "Checking for wt updates";
}

export async function updateCommand(
  options: UpdateInstallationOptions
): Promise<void> {
  await runCommand(async () => {
    if (isHomebrewManagedInstallation()) {
      const plan = buildHomebrewUpdatePlan(options);

      console.log(
        chalk.dim(`Homebrew installation detected. Running: ${plan.displayCommand}`)
      );

      runHomebrewUpdate(plan);
      return;
    }

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
    console.log(chalk.dim("Run: wt --version to verify."));
  });
}
