import chalk from "chalk";
import { listWorktrees } from "../app/use-cases/list-worktrees.js";
import { runCommand } from "../cli/command-runtime.js";

type CompletionFormat = "bash" | "zsh" | "fish";

export async function listCommand(options?: {
  completion?: CompletionFormat;
}): Promise<void> {
  await runCommand(async () => {
    const result = await listWorktrees();

    if (options?.completion) {
      for (const worktree of result.worktrees) {
        let description = worktree.branch;

        if (worktree.baseBranch && worktree.baseCommit) {
          description += ` from ${worktree.baseBranch}@${worktree.baseCommit.substring(0, 7)}`;
        } else if (worktree.baseBranch) {
          description += ` from ${worktree.baseBranch}`;
        }

        if (options.completion === "fish") {
          console.log(`${worktree.id}\t${description}`);
        } else {
          console.log(`${worktree.id}:${description}`);
        }
      }
      return;
    }

    if (result.worktrees.length === 0) {
      console.log(chalk.yellow("No worktrees found"));
      return;
    }

    console.log(chalk.bold(`\nWorktrees (${result.repoName}):`));
    console.log(chalk.dim("─".repeat(80)));

    for (const worktree of result.worktrees) {
      const idLabel = worktree.isCurrent
        ? `${worktree.id} ${chalk.green("(current)")}`
        : worktree.id;
      const timestamp = new Date(worktree.createdAt).toLocaleString();
      const baseInfo =
        worktree.baseBranch && worktree.baseCommit
          ? chalk.dim(`from ${worktree.baseBranch}@${worktree.baseCommit.substring(0, 7)}`)
          : worktree.baseBranch
          ? chalk.dim(`from ${worktree.baseBranch}`)
          : "";
      const indicators = [];

      if (worktree.isMerged) {
        indicators.push(chalk.dim("(merged)"));
      }
      if (worktree.unpushedCount > 0) {
        indicators.push(
          chalk.yellow(`↑${worktree.unpushedCount} commits not pushed`)
        );
      }
      if (worktree.modifiedCount > 0) {
        indicators.push(
          chalk.red(`!${worktree.modifiedCount} files not tracked`)
        );
      }

      const branchParts = [worktree.branch];
      if (baseInfo) {
        branchParts.push(baseInfo);
      }
      if (indicators.length > 0) {
        branchParts.push(indicators.join(" "));
      }

      console.log(chalk.cyan(`ID:      ${idLabel}`));
      console.log(chalk.white(`Branch:  ${branchParts.join(" ")}`));
      console.log(chalk.dim(`Path:    ${worktree.path}`));
      console.log(chalk.dim(`Created: ${timestamp}`));
      console.log(chalk.dim("─".repeat(80)));
    }
  });
}
