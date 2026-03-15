import { AppError } from "../errors.js";
import { resolveWorktreeTarget } from "../../domain/worktree-target.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import {
  deleteBranch,
  removeGitWorktree,
} from "../../infra/git/worktree-repository.js";
import { getWorktreeRemovalStatusSummary } from "../../infra/git/status.js";
import type { WorktreeInfo } from "../../domain/worktree.js";

export interface RemoveWorktreeOptions {
  keepBranch?: boolean;
}

export interface RemoveWorktreePreview {
  worktree: WorktreeInfo;
  localCommitCount: number;
  localChangeCount: number;
  hasUnknownLocalCommits: boolean;
}

export interface RemoveWorktreeResult {
  worktree: WorktreeInfo;
  branchDeleted: boolean;
}

async function resolveRemovalTarget(
  target: string,
  cwd: string
): Promise<{
  context: Awaited<ReturnType<typeof requireRepositoryContext>>;
  worktree: WorktreeInfo;
}> {
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

  return {
    context,
    worktree: result.worktree,
  };
}

export async function inspectRemoveWorktree(
  target: string,
  cwd: string = process.cwd()
): Promise<RemoveWorktreePreview> {
  const { context, worktree } = await resolveRemovalTarget(target, cwd);
  const {
    localCommitCount,
    localChangeCount,
    hasUnknownLocalCommits,
  } = await getWorktreeRemovalStatusSummary(
    context.repoRoot,
    worktree.path,
    worktree.branch,
    worktree.baseBranch
  );

  return {
    worktree,
    localCommitCount,
    localChangeCount,
    hasUnknownLocalCommits,
  };
}

export async function removeWorktree(
  target: string,
  options: RemoveWorktreeOptions,
  cwd: string = process.cwd()
): Promise<RemoveWorktreeResult> {
  const { context, worktree } = await resolveRemovalTarget(target, cwd);

  await removeGitWorktree(context.repoRoot, worktree.path);

  if (options.keepBranch) {
    return {
      worktree,
      branchDeleted: false,
    };
  }

  await deleteBranch(context.repoRoot, worktree.branch);

  return {
    worktree,
    branchDeleted: true,
  };
}
