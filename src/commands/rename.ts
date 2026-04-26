import chalk from "chalk";
import { renameCurrentWorktree } from "../app/use-cases/rename-worktree.js";
import { runCommand } from "../cli/command-runtime.js";

export async function renameCommand(newId: string): Promise<void> {
  await runCommand(async () => {
    const result = await renameCurrentWorktree(newId);

    console.log(
      chalk.green(`✓ Renamed worktree: ${result.oldId} -> ${result.newId}`)
    );
    console.log(chalk.dim(`  WT_ID: ${result.newId}`));
    console.log(chalk.dim(`  WT_PATH: ${result.worktreePath}`));
  });
}
