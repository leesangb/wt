import type { WorktreeInfo, WorktreeState } from "../../domain/worktree.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos, loadWorktreeStates } from "../worktree-catalog.js";

export interface ListWorktreeInfosResult {
  repoName: string;
  worktrees: WorktreeInfo[];
}

export interface ListWorktreesResult {
  repoName: string;
  worktrees: WorktreeState[];
}

export async function listWorktreeInfos(
  cwd: string = process.cwd()
): Promise<ListWorktreeInfosResult> {
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);

  return {
    repoName: context.repoName,
    worktrees,
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
