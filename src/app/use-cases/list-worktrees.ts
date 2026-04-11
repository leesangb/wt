import type {
  WorktreeInfo,
  WorktreeRemovalInfo,
  WorktreeState,
} from "../../domain/worktree.js";
import { requireRepositoryContext } from "../repository-context.js";
import { listPullRequestLinks } from "../../infra/github/cli.js";
import {
  loadWorktreeInfos,
  loadWorktreeRemovalInfos,
  loadWorktreeStates,
} from "../worktree-catalog.js";

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

export interface ListRemoveCompletionWorktreesResult {
  repoName: string;
  worktrees: WorktreeRemovalInfo[];
}

async function enrichWorktreesWithPullRequests<T extends WorktreeInfo>(
  repoRoot: string,
  worktrees: T[]
): Promise<T[]> {
  const shouldResolvePullRequests = worktrees.some(
    (worktree) => !worktree.prUrl && worktree.branch && !worktree.isDetached
  );

  if (!shouldResolvePullRequests) {
    return worktrees;
  }

  const pullRequestsByBranch = await listPullRequestLinks(repoRoot);

  return worktrees.map((worktree) => {
    if (worktree.prUrl || !worktree.branch || worktree.isDetached) {
      return worktree;
    }

    const pullRequest = pullRequestsByBranch.get(worktree.branch);

    if (!pullRequest) {
      return worktree;
    }

    return {
      ...worktree,
      prNumber: pullRequest.number,
      prUrl: pullRequest.url,
    };
  });
}

export async function listWorktreeInfos(
  cwd: string = process.cwd(),
  options: ListWorktreeInfosOptions = {}
): Promise<ListWorktreeInfosResult> {
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);
  const visibleWorktrees = options.excludeMainWorktree
    ? worktrees.filter((worktree) => !worktree.isMain)
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
  const worktrees = await enrichWorktreesWithPullRequests(
    context.repoRoot,
    await loadWorktreeStates(context)
  );

  return {
    repoName: context.repoName,
    worktrees,
  };
}

export async function listRemoveCompletionWorktrees(
  cwd: string = process.cwd(),
  options: ListWorktreeInfosOptions = {}
): Promise<ListRemoveCompletionWorktreesResult> {
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeRemovalInfos(context);
  const visibleWorktrees = options.excludeMainWorktree
    ? worktrees.filter((worktree) => !worktree.isMain)
    : worktrees;

  return {
    repoName: context.repoName,
    worktrees: visibleWorktrees,
  };
}
