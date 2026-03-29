import chalk from "chalk";
import { runCommand } from "../cli/command-runtime.js";
import { installShellIntegration } from "../app/use-cases/install-shell-integration.js";

interface ShellInstallOptions {
  binaryPath?: string;
  shellDir?: string;
}

export async function shellInstallCommand(
  shell: string,
  options: ShellInstallOptions
): Promise<void> {
  await runCommand(async () => {
    const result = installShellIntegration({
      shell,
      binaryPath: options.binaryPath,
      shellDir: options.shellDir,
    });

    console.log(
      chalk.green(
        `✓ Installed ${result.shell} shell integration at ${result.wrapperPath}`
      )
    );
    console.log(chalk.dim("Add this line to your shell config:"));
    console.log(chalk.cyan(`  ${result.sourceLine}`));
  });
}
