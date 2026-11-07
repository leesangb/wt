import type { WorktreeInfo } from "../../domain/worktree.js";
import { resolveWorktreeTarget } from "../../domain/worktree-target.js";
import { requireRepositoryContext } from "../repository-context.js";
import { iterateWorktreeInfos } from "../worktree-catalog.js";

export type ResolveWorktreeCdResult =
  | { worktree: WorktreeInfo }
  | { worktree?: undefined; availableWorktrees: WorktreeInfo[] };

export async function resolveWorktreeCd(
  target: string,
  cwd: string = process.cwd()
): Promise<ResolveWorktreeCdResult> {
  const context = await requireRepositoryContext(cwd);
  const availableWorktrees: WorktreeInfo[] = [];
  for await (const worktree of iterateWorktreeInfos(context)) {
    if (resolveWorktreeTarget([worktree], target, { includeBranch: true }).worktree) {
      return { worktree };
    }
    availableWorktrees.push(worktree);
  }
  return { availableWorktrees };
}
