import chalk from "chalk";
import { createWorktree } from "../app/use-cases/create-worktree.js";
import { runCommand } from "../cli/command-runtime.js";
import { emitShellCd } from "../infra/shell/cd.js";

interface NewCommandOptions {
  base?: string;
  push?: boolean;
  cd?: boolean;
  id?: string;
}

export async function newCommand(
  branchName: string,
  options: NewCommandOptions
): Promise<void> {
  await runCommand(async () => {
    console.log(chalk.blue("Fetching latest changes..."));
    const result = await createWorktree(branchName, options);

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
    console.log(chalk.dim(`  WT_ID: ${result.shortId}`));
    console.log(chalk.dim(`  WT_PATH: ${result.worktreePath}`));
    console.log(chalk.dim(`  WT_BRANCH: ${result.branchName}`));

    if (options.cd !== false) {
      emitShellCd(result.worktreePath);
      return;
    }

    console.log(chalk.cyan(`\nTo navigate to the worktree, run:`));
    console.log(chalk.cyan(`  cd ${result.worktreePath}`));
  });
}
