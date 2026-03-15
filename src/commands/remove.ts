import chalk from "chalk";
import { removeWorktree } from "../app/use-cases/remove-worktree.js";
import { runCommand } from "../cli/command-runtime.js";
interface RemoveCommandOptions {
  keepBranch?: boolean;
}

export async function removeCommand(id: string, options: RemoveCommandOptions): Promise<void> {
  await runCommand(async () => {
    const result = await removeWorktree(id, options);

    console.log(
      chalk.blue(
        `Removing worktree: ${result.worktree.branch} (${result.worktree.id})...`
      )
    );
    console.log(chalk.green(`✓ Worktree removed`));

    if (result.branchDeleted) {
      console.log(chalk.blue(`Deleting branch: ${result.worktree.branch}...`));
      console.log(chalk.green(`✓ Branch deleted`));
      return;
    }

    console.log(chalk.yellow(`Branch ${result.worktree.branch} kept`));
  });
}
