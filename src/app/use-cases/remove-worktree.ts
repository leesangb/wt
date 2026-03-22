import { AppError } from "../errors.js";
import { isPathInside } from "../../domain/path.js";
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
  relocatedToPath?: string;
}

export class RemoveWorktreeError extends AppError {
  readonly relocatedToPath?: string;

  constructor(message: string, relocatedToPath?: string) {
    super(message);
    this.name = "RemoveWorktreeError";
    this.relocatedToPath = relocatedToPath;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
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

async function resolveSafeRemovalRoot(
  context: Awaited<ReturnType<typeof requireRepositoryContext>>,
  worktree: WorktreeInfo
): Promise<{
  gitRoot: string;
  relocatedToPath?: string;
}> {
  if (!isPathInside(worktree.path, context.cwd)) {
    return {
      gitRoot: context.repoRoot,
    };
  }

  const worktrees = await loadWorktreeInfos(context);
  const safeWorktree =
    worktrees.find((candidate) => candidate.isMain && candidate.path !== worktree.path) ??
    worktrees.find((candidate) => candidate.path !== worktree.path);

  if (!safeWorktree) {
    throw new AppError("Could not find another worktree to remove this worktree safely");
  }

  process.chdir(safeWorktree.path);

  return {
    gitRoot: safeWorktree.path,
    relocatedToPath: safeWorktree.path,
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
  const removalRoot = await resolveSafeRemovalRoot(context, worktree);

  await removeGitWorktree(removalRoot.gitRoot, worktree.path);

  if (options.keepBranch) {
    return {
      worktree,
      branchDeleted: false,
      relocatedToPath: removalRoot.relocatedToPath,
    };
  }

  try {
    await deleteBranch(removalRoot.gitRoot, worktree.branch);
  } catch (error) {
    throw new RemoveWorktreeError(
      getErrorMessage(error),
      removalRoot.relocatedToPath
    );
  }

  return {
    worktree,
    branchDeleted: true,
    relocatedToPath: removalRoot.relocatedToPath,
  };
}
