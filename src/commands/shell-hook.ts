import chalk from "chalk";
import {
  generateShellHook,
  isSupportedShell,
} from "../utils/shell.js";

export async function shellHookCommand(shell: string): Promise<void> {
  const normalizedShell = shell.toLowerCase();

  if (!isSupportedShell(normalizedShell)) {
    console.error(
      chalk.red(`Unsupported shell: ${shell}. Use one of: bash, zsh, fish.`)
    );
    process.exit(1);
  }

  process.stdout.write(generateShellHook(normalizedShell));
}
