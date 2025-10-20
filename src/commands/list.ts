import chalk from "chalk";
import { isGitRepository, listWorktrees } from "../utils/git.js";

export async function listCommand(): Promise<void> {
  if (!(await isGitRepository())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  const worktrees = await listWorktrees();

  if (worktrees.length === 0) {
    console.log(chalk.yellow("No worktrees found"));
    return;
  }

  const currentPath = process.cwd();
  const currentWorktree = worktrees.find(wt => currentPath.startsWith(wt.path));
  
  const sortedWorktrees = currentWorktree
    ? [currentWorktree, ...worktrees.filter(wt => wt.path !== currentWorktree.path)]
    : worktrees;

  console.log(chalk.bold(`\nWorktrees (${worktrees[0].repoName}):`));
  console.log(chalk.dim("─".repeat(80)));

  for (const wt of sortedWorktrees) {
    const isCurrent = wt.path === currentWorktree?.path;
    const idLabel = isCurrent ? `${wt.id} ${chalk.green("(current)")}` : wt.id;
    
    const createdDate = new Date(wt.createdAt);
    const timestamp = createdDate.toLocaleString();
    
    console.log(chalk.cyan(`ID:      ${idLabel}`));
    console.log(chalk.white(`Branch:  ${wt.branch}`));
    console.log(chalk.dim(`Path:    ${wt.path}`));
    console.log(chalk.dim(`Created: ${timestamp}`));
    console.log(chalk.dim("─".repeat(80)));
  }
}
