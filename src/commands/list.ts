import chalk from "chalk";
import {
  isGitRepository,
  listWorktrees,
  getDefaultRemoteBranch,
  getMergedRemoteBranches,
  getWorktreeStatusSummary,
} from "../utils/git.js";

type CompletionFormat = "bash" | "zsh" | "fish";

export async function listCommand(options?: {
  completion?: CompletionFormat;
}): Promise<void> {
  if (!(await isGitRepository())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  const worktrees = await listWorktrees();

  if (options?.completion) {
    for (const wt of worktrees) {
      let description = wt.branch;
      if (wt.baseBranch && wt.baseCommit) {
        description += ` from ${wt.baseBranch}@${wt.baseCommit.substring(
          0,
          7
        )}`;
      } else if (wt.baseBranch) {
        description += ` from ${wt.baseBranch}`;
      }

      if (options.completion === "fish") {
        console.log(`${wt.id}\t${description}`);
      } else {
        console.log(`${wt.id}:${description}`);
      }
    }
    return;
  }

  if (worktrees.length === 0) {
    console.log(chalk.yellow("No worktrees found"));
    return;
  }

  const currentPath = process.cwd();
  const currentWorktree = worktrees.find((wt) =>
    currentPath.startsWith(wt.path)
  );

  const sortedWorktrees = currentWorktree
    ? [
        currentWorktree,
        ...worktrees.filter((wt) => wt.path !== currentWorktree.path),
      ]
    : worktrees;

  console.log(chalk.bold(`\nWorktrees (${worktrees[0].repoName}):`));
  console.log(chalk.dim("─".repeat(80)));

  const defaultRemoteBaseBranch = await getDefaultRemoteBranch();
  const baseBranches = [
    ...new Set(
      sortedWorktrees
        .map((wt) => wt.baseBranch ?? defaultRemoteBaseBranch)
        .filter((branch): branch is string => Boolean(branch))
    ),
  ];
  const mergedBranchesByBase = new Map<string, Set<string>>(
    await Promise.all(
      baseBranches.map(
        async (baseBranch): Promise<[string, Set<string>]> => [
          baseBranch,
          await getMergedRemoteBranches(baseBranch),
        ]
      )
    )
  );
  const worktreeStates = await Promise.all(
    sortedWorktrees.map(async (wt) => {
      const mergeBaseBranch = wt.baseBranch ?? defaultRemoteBaseBranch;
      const mergedBranches = mergeBaseBranch
        ? mergedBranchesByBase.get(mergeBaseBranch)
        : undefined;
      const { unpushedCount, modifiedCount } = await getWorktreeStatusSummary(
        wt.path,
        wt.branch
      );
      const isMerged = mergedBranches?.has(`origin/${wt.branch}`) ?? false;

      return { wt, isMerged, unpushedCount, modifiedCount };
    })
  );

  for (const { wt, isMerged, unpushedCount, modifiedCount } of worktreeStates) {
    const isCurrent = wt.path === currentWorktree?.path;
    const idLabel = isCurrent ? `${wt.id} ${chalk.green("(current)")}` : wt.id;

    const createdDate = new Date(wt.createdAt);
    const timestamp = createdDate.toLocaleString();

    const baseInfo =
      wt.baseBranch && wt.baseCommit
        ? chalk.dim(`from ${wt.baseBranch}@${wt.baseCommit.substring(0, 7)}`)
        : wt.baseBranch
        ? chalk.dim(`from ${wt.baseBranch}`)
        : "";

    const indicators: string[] = [];
    if (isMerged) indicators.push(chalk.dim("(merged)"));
    if (unpushedCount > 0)
      indicators.push(chalk.yellow(`↑${unpushedCount} commits not pushed`));
    if (modifiedCount > 0)
      indicators.push(chalk.red(`!${modifiedCount} files not tracked`));

    const parts = [wt.branch];
    if (baseInfo) parts.push(baseInfo);
    if (indicators.length > 0) parts.push(indicators.join(" "));
    const branchLabel = parts.join(" ");

    console.log(chalk.cyan(`ID:      ${idLabel}`));
    console.log(chalk.white(`Branch:  ${branchLabel}`));
    console.log(chalk.dim(`Path:    ${wt.path}`));
    console.log(chalk.dim(`Created: ${timestamp}`));
    console.log(chalk.dim("─".repeat(80)));
  }
}
