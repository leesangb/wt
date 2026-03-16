import chalk from "chalk";
import { createPullRequestWorktree } from "../app/use-cases/create-pr-worktree.js";
import { runCommand } from "../cli/command-runtime.js";
import { emitShellCd } from "../infra/shell/cd.js";

interface PrCommandOptions {
  cd?: boolean;
}

export async function prCommand(
  pullRequestNumber: string,
  options: PrCommandOptions
): Promise<void> {
  await runCommand(async () => {
    console.log(chalk.blue(`Preparing pull request #${pullRequestNumber}...`));
    const result = await createPullRequestWorktree(pullRequestNumber);

    console.log(
      chalk.green(
        result.created
          ? `✓ Created PR worktree: #${pullRequestNumber}`
          : `✓ Refreshed PR worktree: #${pullRequestNumber}`
      )
    );

    if (result.postMode === "async" && result.postTask) {
      console.log(chalk.blue("Starting post scripts in background..."));
      console.log(chalk.dim(`  PID: ${result.postTask.pid}`));
      console.log(chalk.dim(`  Status: ${result.postTask.statusFilePath}`));
      console.log(chalk.dim(`  Log: ${result.postTask.logFilePath}`));
    } else if (result.postMode === "sync") {
      console.log(chalk.blue("Running post scripts..."));
    }

    console.log(chalk.green(`\n✓ Pull request worktree ready!`));
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
