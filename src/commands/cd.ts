import chalk from "chalk";
import { isGitRepository, listWorktrees } from "../utils/git.js";

export async function cdCommand(target: string): Promise<void> {
  if (!(await isGitRepository())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  const worktrees = await listWorktrees();

  const worktree = worktrees.find(
    wt => wt.id === target || wt.branch === target
  );

  if (!worktree) {
    console.error(chalk.red(`Error: Worktree not found: ${target}`));
    console.log(chalk.dim("\nAvailable worktrees:"));
    for (const wt of worktrees) {
      console.log(chalk.cyan(`  ${wt.id}`) + chalk.dim(` (${wt.branch})`));
    }
    process.exit(1);
  }

  console.log(`cd ${worktree.path}`);
}
