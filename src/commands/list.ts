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

  console.log(chalk.bold("\nWorktrees:"));
  console.log(chalk.dim("─".repeat(80)));

  for (const wt of worktrees) {
    console.log(chalk.cyan(`ID:      ${wt.id}`));
    console.log(chalk.white(`Branch:  ${wt.branch}`));
    console.log(chalk.dim(`Path:    ${wt.path}`));
    console.log(chalk.dim("─".repeat(80)));
  }
}
