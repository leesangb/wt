import type { WorktreeInfo } from "./worktree.js";

export interface ResolveWorktreeTargetOptions {
  includeBranch?: boolean;
  allowPartialPath?: boolean;
}

export interface ResolveWorktreeTargetResult {
  worktree?: WorktreeInfo;
  error?: string;
}

export function resolveWorktreeTarget(
  worktrees: WorktreeInfo[],
  target: string,
  options: ResolveWorktreeTargetOptions = {}
): ResolveWorktreeTargetResult {
  const exactMatch = worktrees.find((wt) => {
    if (
      wt.id === target ||
      wt.fullId === target ||
      wt.path === target
    ) {
      return true;
    }

    if (options.includeBranch && wt.branch === target) {
      return true;
    }

    return false;
  });

  if (exactMatch) {
    return { worktree: exactMatch };
  }

  if (!options.allowPartialPath) {
    return {
      error: `Worktree with target "${target}" not found`,
    };
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
    error: `Worktree with target "${target}" not found`,
  };
}
