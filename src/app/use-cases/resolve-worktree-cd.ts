import type { WorktreeInfo } from "../../domain/worktree.js";
import { resolveWorktreeTarget } from "../../domain/worktree-target.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";

export interface ResolveWorktreeCdResult {
  worktree?: WorktreeInfo;
  availableWorktrees: WorktreeInfo[];
}

export async function resolveWorktreeCd(
  target: string,
  cwd: string = process.cwd()
): Promise<ResolveWorktreeCdResult> {
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);
  const result = resolveWorktreeTarget(worktrees, target, {
    includeBranch: true,
    allowPartialPath: false,
  });

  return {
    worktree: result.worktree,
    availableWorktrees: worktrees,
  };
}
