import chalk from "chalk";
import { createWorktree } from "../app/use-cases/create-worktree.js";
import { runCommand } from "../cli/command-runtime.js";
import { emitShellCd } from "../infra/shell/cd.js";
import { printWorktreeCommandResult } from "../cli/worktree-result.js";
import { openCreatedWorktreeInHerdr } from "../app/use-cases/open-worktree-in-herdr.js";

interface NewCommandOptions {
  base?: string;
  push?: boolean;
  cd?: boolean;
  id?: string;
  json?: boolean;
}

export async function newCommand(
  branchName: string,
  options: NewCommandOptions
): Promise<void> {
  await runCommand(async () => {
    if (!options.json) {
      console.log(chalk.blue("Fetching latest changes..."));
    }
    const result = await createWorktree(branchName, options);
    const herdr = await openCreatedWorktreeInHerdr(result, {
      focus: options.cd !== false,
    });

    if (herdr.error) {
      console.error(chalk.yellow(`Warning: Could not open in Herdr: ${herdr.error}`));
    }

    if (options.json) {
      printWorktreeCommandResult(result);
      return;
    }

    console.log(chalk.green(`✓ Created worktree: ${branchName}`));

    if (result.postMode === "async" && result.postTask) {
      console.log(chalk.blue("Starting post scripts in background..."));
      console.log(chalk.dim(`  PID: ${result.postTask.pid}`));
      console.log(chalk.dim(`  Status: ${result.postTask.statusFilePath}`));
      console.log(chalk.dim(`  Log: ${result.postTask.logFilePath}`));
    } else if (result.postMode === "sync") {
      console.log(chalk.blue("Running post scripts..."));
    }

    console.log(chalk.green(`\n✓ Worktree created successfully!`));
    console.log(chalk.dim(`  WT_ID: ${result.id}`));
    console.log(chalk.dim(`  WT_PATH: ${result.worktreePath}`));
    console.log(chalk.dim(`  WT_BRANCH: ${result.branchName}`));

    if (herdr.opened) {
      console.log(chalk.green("  Opened in Herdr"));
      return;
    }

    if (options.cd !== false) {
      emitShellCd(result.worktreePath);
      return;
    }

    console.log(chalk.cyan(`\nTo navigate to the worktree, run:`));
    console.log(chalk.cyan(`  cd ${result.worktreePath}`));
  });
}
