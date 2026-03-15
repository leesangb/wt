import chalk from "chalk";
import { AppError } from "../app/errors.js";

export async function runCommand(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(error.exitCode);
    }

    console.error(chalk.red(`Error: ${error}`));
    process.exit(1);
  }
}
