import chalk from "chalk";
import { installHerdrPlugin } from "../app/use-cases/install-herdr-plugin.js";
import { runCommand } from "../cli/command-runtime.js";

export async function herdrInstallCommand(): Promise<void> {
  await runCommand(async () => {
    await installHerdrPlugin();
    console.log(chalk.green("✓ Installed wt for Herdr"));
  });
}
