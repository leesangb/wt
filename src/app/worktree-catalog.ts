import { statSync } from "fs";
import { relative } from "path";
import type { RepositoryContext } from "./repository-context.js";
import {
  buildWorktreeIdentifiers,
  type WorktreeInfo,
  type WorktreeMergeStatus,
  type WorktreeRemovalInfo,
  type WorktreeState,
} from "../domain/worktree.js";
import { listGitWorktrees } from "../infra/git/worktree-repository.js";
import {
  getDefaultRemoteBranch,
  getMergedRemoteBranchesResult,
  getWorktreeStatusSummary,
} from "../infra/git/status.js";
import { readWorktreeMeta } from "../infra/storage/worktree-meta-store.js";

function isPathInside(parentPath: string, childPath: string): boolean {
  const relPath = relative(parentPath, childPath);

  return (
    relPath === "" ||
    (!relPath.startsWith("..") && relPath !== ".." && !relPath.startsWith("../"))
  );
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
        repoName: context.repoName,
        createdAt:
          meta?.createdAt ?? statSync(worktree.path).birthtime.toISOString(),
        baseBranch: meta?.baseBranch,
        baseCommit: meta?.baseCommit,
      };
    })
  );
}

export async function loadWorktreeStates(
  context: RepositoryContext
): Promise<WorktreeState[]> {
  const worktrees = await loadWorktreeInfos(context);
  const mergeMetadata = await loadMergeMetadata(context, worktrees);

  const worktreeStates = await Promise.all(
    worktrees.map(async (worktree) => {
      const mergeStatus = resolveWorktreeMergeStatus(worktree, mergeMetadata);
      const { unpushedCount, modifiedCount } = await getWorktreeStatusSummary(
        worktree.path,
        worktree.branch
      );

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
  const mergeMetadata = await loadMergeMetadata(context, worktrees);

  return worktrees.map((worktree) => ({
    ...worktree,
    mergeStatus: resolveWorktreeMergeStatus(worktree, mergeMetadata),
  }));
}

async function loadMergeMetadata(
  context: RepositoryContext,
  worktrees: WorktreeInfo[]
): Promise<{
  defaultRemoteBaseBranch?: string;
  mergedBranchesByBase: Map<
    string,
    Awaited<ReturnType<typeof getMergedRemoteBranchesResult>>
  >;
}> {
  const defaultRemoteBaseBranch = await getDefaultRemoteBranch(context.repoRoot);
  const baseBranches = [
    ...new Set(
      worktrees
        .map((wt) => wt.baseBranch ?? defaultRemoteBaseBranch)
        .filter((branch): branch is string => Boolean(branch))
    ),
  ];
  const mergedBranchEntries = await Promise.all(
    baseBranches.map(
      async (
        baseBranch
      ): Promise<
        readonly [
          string,
          Awaited<ReturnType<typeof getMergedRemoteBranchesResult>>,
        ]
      > => [
        baseBranch,
        await getMergedRemoteBranchesResult(context.repoRoot, baseBranch),
      ]
    )
  );

  return {
    defaultRemoteBaseBranch,
    mergedBranchesByBase: new Map(mergedBranchEntries),
  };
}

function resolveWorktreeMergeStatus(
  worktree: WorktreeInfo,
  mergeMetadata: {
    defaultRemoteBaseBranch?: string;
    mergedBranchesByBase: Map<
      string,
      Awaited<ReturnType<typeof getMergedRemoteBranchesResult>>
    >;
  }
): WorktreeMergeStatus {
  const mergeBaseBranch =
    worktree.baseBranch ?? mergeMetadata.defaultRemoteBaseBranch;

  if (!mergeBaseBranch) {
    return "unknown";
  }

  const mergeResult = mergeMetadata.mergedBranchesByBase.get(mergeBaseBranch);
  if (!mergeResult?.known) {
    return "unknown";
  }

  return mergeResult.branches.has(`origin/${worktree.branch}`)
    ? "merged"
    : "not_merged";
}
