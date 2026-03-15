import chalk from "chalk";
import { initSettings } from "../app/use-cases/init-settings.js";
import { runCommand } from "../cli/command-runtime.js";

export async function initCommand(): Promise<void> {
  await runCommand(async () => {
    const result = await initSettings();

    if (!result.created) {
      console.log(chalk.yellow("Warning: .wt/settings.json already exists"));
      return;
    }

    console.log(chalk.green("✓ Initialized wt configuration at .wt/settings.json"));
    console.log(chalk.dim("\nEdit .wt/settings.json to customize:"));
    console.log(chalk.dim("  - worktreeDir: Base directory for worktrees"));
    console.log(chalk.dim("  - baseBranch: Default base branch (default: main)"));
    console.log(chalk.dim("  - pushRemote: Auto-push new branch to remote (default: true)"));
    console.log(chalk.dim("  - scripts.pre: Array of commands to run before creating worktree"));
    console.log(chalk.dim("  - scripts.post: Array of commands to run after creating worktree"));
    console.log(chalk.dim("  - scripts.postMode: 'sync' | 'async' (default: async)"));
  });
}
