import chalk from "chalk";
import { isGitRepository, listWorktrees, removeWorktree } from "../utils/git.js";

export async function removeCommand(id: string): Promise<void> {
  if (!(await isGitRepository())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  const worktrees = await listWorktrees();
  const worktree = worktrees.find((wt) => wt.id === id || wt.path.includes(id));

  if (!worktree) {
    console.error(chalk.red(`Error: Worktree with ID "${id}" not found`));
    process.exit(1);
  }

  try {
    console.log(chalk.blue(`Removing worktree: ${worktree.branch} (${worktree.id})...`));
    await removeWorktree(worktree.path);
    console.log(chalk.green(`✓ Worktree removed successfully`));
  } catch (error) {
    console.error(chalk.red(`Error removing worktree: ${error}`));
    process.exit(1);
  }
}
