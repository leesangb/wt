import chalk from "chalk";
import { createPrWorktree } from "../app/use-cases/create-pr-worktree.js";
import { runCommand } from "../cli/command-runtime.js";
import { emitShellCd } from "../infra/shell/cd.js";
import { printWorktreeCommandResult } from "../cli/worktree-result.js";

interface PrCommandOptions {
  cd?: boolean;
  json?: boolean;
}

export async function prCommand(
  pullRequestNumber: string,
  options: PrCommandOptions
): Promise<void> {
  await runCommand(async () => {
    const result = await createPrWorktree(pullRequestNumber);

    if (options.json) {
      printWorktreeCommandResult(result);
      return;
    }

    if (result.reusedExisting) {
      console.log(chalk.green(`✓ Using existing PR worktree: ${result.branchName}`));
    } else {
      console.log(chalk.green(`✓ Created PR worktree: ${result.branchName}`));
    }

    if (result.idAdjustedFrom) {
      console.log(
        chalk.yellow(
          `Adjusted WT_ID from ${result.idAdjustedFrom} to ${result.id} because that ID is already in use.`
        )
      );
    }

    if (result.postMode === "async" && result.postTask) {
      console.log(chalk.blue("Starting post scripts in background..."));
      console.log(chalk.dim(`  PID: ${result.postTask.pid}`));
      console.log(chalk.dim(`  Status: ${result.postTask.statusFilePath}`));
      console.log(chalk.dim(`  Log: ${result.postTask.logFilePath}`));
    } else if (result.postMode === "sync") {
      console.log(chalk.blue("Running post scripts..."));
    }

    console.log(chalk.green(`\n✓ PR worktree ready!`));
    console.log(chalk.dim(`  WT_ID: ${result.id}`));
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
