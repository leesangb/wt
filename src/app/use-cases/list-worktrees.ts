import type { WorktreeInfo, WorktreeState } from "../../domain/worktree.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos, loadWorktreeStates } from "../worktree-catalog.js";

export interface ListWorktreeInfosOptions {
  excludeMainWorktree?: boolean;
}

export interface ListWorktreeInfosResult {
  repoName: string;
  worktrees: WorktreeInfo[];
}

export interface ListWorktreesResult {
  repoName: string;
  worktrees: WorktreeState[];
}

export async function listWorktreeInfos(
  cwd: string = process.cwd(),
  options: ListWorktreeInfosOptions = {}
): Promise<ListWorktreeInfosResult> {
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);
  const visibleWorktrees = options.excludeMainWorktree
    ? worktrees.filter((worktree) => worktree.path !== context.repoRoot)
    : worktrees;

  return {
    repoName: context.repoName,
    worktrees: visibleWorktrees,
  };
}

export async function listWorktrees(
  cwd: string = process.cwd()
): Promise<ListWorktreesResult> {
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeStates(context);

  return {
    repoName: context.repoName,
    worktrees,
  };
}
