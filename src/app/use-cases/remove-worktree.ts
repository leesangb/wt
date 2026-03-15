import { AppError } from "../errors.js";
import { resolveWorktreeTarget } from "../../domain/worktree-target.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import {
  deleteBranch,
  removeGitWorktree,
} from "../../infra/git/worktree-repository.js";
import type { WorktreeInfo } from "../../domain/worktree.js";

export interface RemoveWorktreeOptions {
  keepBranch?: boolean;
}

export interface RemoveWorktreeResult {
  worktree: WorktreeInfo;
  branchDeleted: boolean;
}

export async function removeWorktree(
  target: string,
  options: RemoveWorktreeOptions,
  cwd: string = process.cwd()
): Promise<RemoveWorktreeResult> {
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);
  const result = resolveWorktreeTarget(worktrees, target, {
    allowPartialPath: true,
  });

  if (!result.worktree) {
    throw new AppError(
      result.error?.replace('target "', 'ID "') ??
        `Worktree with ID "${target}" not found`
    );
  }

  await removeGitWorktree(context.repoRoot, result.worktree.path);

  if (options.keepBranch) {
    return {
      worktree: result.worktree,
      branchDeleted: false,
    };
  }

  await deleteBranch(context.repoRoot, result.worktree.branch);

  return {
    worktree: result.worktree,
    branchDeleted: true,
  };
}
