import { statSync } from "fs";
import { relative } from "path";
import type { RepositoryContext } from "./repository-context.js";
import {
  buildWorktreeIdentifiers,
  type WorktreeInfo,
  type WorktreeState,
} from "../domain/worktree.js";
import { listGitWorktrees } from "../infra/git/worktree-repository.js";
import {
  getDefaultRemoteBranch,
  getMergedRemoteBranches,
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
        worktree.path
      );

      return {
        id,
        fullId,
        path: worktree.path,
        branch: worktree.branch,
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
  const defaultRemoteBaseBranch = await getDefaultRemoteBranch(context.repoRoot);
  const baseBranches = [
    ...new Set(
      worktrees
        .map((wt) => wt.baseBranch ?? defaultRemoteBaseBranch)
        .filter((branch): branch is string => Boolean(branch))
    ),
  ];
  const mergedBranchesByBase = new Map(
    await Promise.all(
      baseBranches.map(async (baseBranch) => [
        baseBranch,
        await getMergedRemoteBranches(context.repoRoot, baseBranch),
      ])
    )
  );

  const worktreeStates = await Promise.all(
    worktrees.map(async (worktree) => {
      const mergeBaseBranch = worktree.baseBranch ?? defaultRemoteBaseBranch;
      const mergedBranches = mergeBaseBranch
        ? mergedBranchesByBase.get(mergeBaseBranch)
        : undefined;
      const { unpushedCount, modifiedCount } = await getWorktreeStatusSummary(
        worktree.path,
        worktree.branch
      );

      return {
        ...worktree,
        isCurrent: isPathInside(worktree.path, context.cwd),
        isMerged: mergedBranches?.has(`origin/${worktree.branch}`) ?? false,
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
