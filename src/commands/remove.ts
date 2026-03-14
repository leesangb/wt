import chalk from "chalk";
import { isGitRepository, listWorktrees, removeWorktree, deleteBranch } from "../utils/git.js";
import type { WorktreeInfo } from "../types/index.js";

interface RemoveCommandOptions {
  keepBranch?: boolean;
}

interface ResolveRemovalTargetResult {
  worktree?: WorktreeInfo;
  error?: string;
}

export function resolveRemovalTarget(
  worktrees: WorktreeInfo[],
  target: string
): ResolveRemovalTargetResult {
  const exactMatch = worktrees.find(
    (wt) => wt.id === target || wt.fullId === target || wt.path === target
  );

  if (exactMatch) {
    return { worktree: exactMatch };
  }

  const partialMatches = worktrees.filter((wt) => wt.path.includes(target));

  if (partialMatches.length === 1) {
    return { worktree: partialMatches[0] };
  }

  if (partialMatches.length > 1) {
    const candidates = partialMatches
      .map((wt) => `${wt.id} (${wt.path})`)
      .join(", ");

    return {
      error: `Ambiguous worktree target "${target}". Matches: ${candidates}`,
    };
  }

  return {
    error: `Worktree with ID "${target}" not found`,
  };
}

export async function removeCommand(id: string, options: RemoveCommandOptions): Promise<void> {
  if (!(await isGitRepository())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  const worktrees = await listWorktrees();
  const result = resolveRemovalTarget(worktrees, id);

  if (!result.worktree) {
    console.error(chalk.red(`Error: ${result.error}`));
    process.exit(1);
  }

  const worktree = result.worktree;

  try {
    console.log(chalk.blue(`Removing worktree: ${worktree.branch} (${worktree.id})...`));
    await removeWorktree(worktree.path);
    console.log(chalk.green(`✓ Worktree removed`));

    if (!options.keepBranch) {
      console.log(chalk.blue(`Deleting branch: ${worktree.branch}...`));
      await deleteBranch(worktree.branch);
      console.log(chalk.green(`✓ Branch deleted`));
    } else {
      console.log(chalk.yellow(`Branch ${worktree.branch} kept`));
    }
  } catch (error) {
    console.error(chalk.red(`Error removing worktree: ${error}`));
    process.exit(1);
  }
}
