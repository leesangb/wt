import chalk from "chalk";
import {
  generateCompletion,
  isSupportedShell,
} from "../utils/shell.js";

export async function completionCommand(shell: string): Promise<void> {
  const normalizedShell = shell.toLowerCase();

  if (!isSupportedShell(normalizedShell)) {
    console.error(
      chalk.red(`Unsupported shell: ${shell}. Use one of: bash, zsh, fish.`)
    );
    process.exit(1);
  }

  process.stdout.write(generateCompletion(normalizedShell));
}
