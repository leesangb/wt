import chalk from "chalk";
import { getCurrentWorktree } from "../app/use-cases/get-current-worktree.js";
import { runCommand } from "../cli/command-runtime.js";
import {
  buildIssueSummary,
  buildPullRequestSummary,
  buildWorktreeBranchSummary,
  buildWorktreeIdLabel,
} from "./worktree-display.js";

export async function currentCommand(): Promise<void> {
  await runCommand(async () => {
    const result = await getCurrentWorktree();
    const { worktree } = result;
    const pullRequestSummary = buildPullRequestSummary(worktree);
    const issueSummary = buildIssueSummary(worktree);
    const timestamp = new Date(worktree.createdAt).toLocaleString();

    console.log(chalk.bold(`\nCurrent worktree (${result.repoName}):`));
    console.log(chalk.dim("─".repeat(80)));
    console.log(
      chalk.cyan(
        `ID:      ${buildWorktreeIdLabel({ ...worktree, isCurrent: true })}`
      )
    );
    console.log(
      chalk.white(`Branch:  ${buildWorktreeBranchSummary(worktree)}`)
    );
    if (issueSummary) {
      console.log(`Issue:   ${issueSummary}`);
    }
    if (pullRequestSummary) {
      console.log(`PR:      ${pullRequestSummary}`);
    }
    console.log(chalk.dim(`Path:    ${worktree.path}`));
    console.log(chalk.dim(`Created: ${timestamp}`));
    console.log(chalk.dim("─".repeat(80)));
  });
}
