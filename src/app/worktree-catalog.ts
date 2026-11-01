import { statSync } from "fs";
import type { RepositoryContext } from "./repository-context.js";
import {
  buildWorktreeIdentifiers,
  type WorktreeInfo,
  type WorktreeMergeStatus,
  type WorktreeRemovalInfo,
  type WorktreeState,
} from "../domain/worktree.js";
import { isPathInside } from "../domain/path.js";
import { listGitWorktrees } from "../infra/git/worktree-repository.js";
import {
  createBranchMergeChecker,
  getWorktreeStatusSummary,
} from "../infra/git/status.js";
import { readWorktreeMeta } from "../infra/storage/worktree-meta-store.js";

function resolveCreatedAt(
  worktreePath: string,
  createdAt?: string
): string {
  if (createdAt) {
    return createdAt;
  }

  try {
    return statSync(worktreePath).birthtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

export async function loadWorktreeInfos(
  context: RepositoryContext
): Promise<WorktreeInfo[]> {
  const gitWorktrees = await listGitWorktrees(context.repoRoot);

  return Promise.all(
    gitWorktrees.map(async (worktree) => {
      const meta = await readWorktreeMeta(worktree.path);
      const { id, fullId } = buildWorktreeIdentifiers(
        context.repoName,
        worktree.path,
        meta
      );

      return {
        id,
        fullId,
        path: worktree.path,
        branch: worktree.branch,
        isMain: worktree.isMain,
        isDetached: worktree.isDetached,
        head: worktree.head,
        repoName: context.repoName,
        createdAt: resolveCreatedAt(worktree.path, meta?.createdAt),
        baseBranch: meta?.baseBranch,
        baseCommit: meta?.baseCommit,
        prNumber: meta?.prNumber,
        prUrl: meta?.prUrl,
      };
    })
  );
}

export async function loadWorktreeStates(
  context: RepositoryContext,
  worktrees?: WorktreeInfo[]
): Promise<WorktreeState[]> {
  const infos = worktrees ?? await loadWorktreeInfos(context);
  const isBranchMerged = createBranchMergeChecker(context.repoRoot);

  const worktreeStates = await Promise.all(
    infos.map(async (worktree) => {
      const [mergeStatus, { unpushedCount, modifiedCount }] = await Promise.all([
        resolveWorktreeMergeStatus(worktree, isBranchMerged),
        getWorktreeStatusSummary(worktree.path, worktree.branch),
      ]);

      return {
        ...worktree,
        isCurrent: isPathInside(worktree.path, context.cwd),
        isMerged: mergeStatus === "merged",
        unpushedCount,
        modifiedCount,
      };
    })
  );

  const currentWorktree = worktreeStates.find((wt) => wt.isCurrent);

  if (!currentWorktree) {
    return worktreeStates;
  }

  return [
    currentWorktree,
    ...worktreeStates.filter((wt) => wt.path !== currentWorktree.path),
  ];
}

export async function loadWorktreeRemovalInfos(
  context: RepositoryContext
): Promise<WorktreeRemovalInfo[]> {
  const worktrees = await loadWorktreeInfos(context);
  const isBranchMerged = createBranchMergeChecker(context.repoRoot);

  return Promise.all(
    worktrees.map(async (worktree) => ({
      ...worktree,
      mergeStatus: await resolveWorktreeMergeStatus(
        worktree,
        isBranchMerged
      ),
    }))
  );
}

async function resolveWorktreeMergeStatus(
  worktree: WorktreeInfo,
  isBranchMerged: ReturnType<typeof createBranchMergeChecker>
): Promise<WorktreeMergeStatus> {
  if (worktree.isDetached || !worktree.branch) {
    return "unknown";
  }

  try {
    const isMerged = await isBranchMerged(worktree.branch, worktree.baseBranch);
    return isMerged ? "merged" : "not_merged";
  } catch {
    return "unknown";
  }
}
