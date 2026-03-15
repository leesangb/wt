import type { WorktreeState } from "../../domain/worktree.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeStates } from "../worktree-catalog.js";

export interface ListWorktreesResult {
  repoName: string;
  worktrees: WorktreeState[];
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
