import { isPathInside } from "../../domain/path.js";
import type { WorktreeInfo, WorktreeMeta } from "../../domain/worktree.js";
import {
  readWorktreeMeta,
  writeWorktreeMeta,
} from "../../infra/storage/worktree-meta-store.js";
import { AppError } from "../errors.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";

export interface RenameWorktreeResult {
  oldId: string;
  newId: string;
  fullId: string;
  worktreePath: string;
}

function normalizeWorktreeId(id: string): string {
  const value = id.trim();

  if (!value) {
    throw new AppError("Worktree ID is required");
  }

  return value;
}

function findCurrentWorktree(
  worktrees: WorktreeInfo[],
  cwd: string
): WorktreeInfo | undefined {
  return worktrees
    .filter((worktree) => isPathInside(worktree.path, cwd))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

function assertIdAvailable(
  worktrees: WorktreeInfo[],
  currentWorktree: WorktreeInfo,
  newId: string,
  newFullId: string
): void {
  const conflictingWorktree = worktrees.find((worktree) => {
    if (worktree.path === currentWorktree.path) {
      return false;
    }

    return (
      worktree.id === newId ||
      worktree.id === newFullId ||
      worktree.fullId === newId ||
      worktree.fullId === newFullId
    );
  });

  if (conflictingWorktree) {
    throw new AppError(`Worktree ID "${newId}" is already in use`);
  }
}

function buildRenamedMeta(
  worktree: WorktreeInfo,
  meta: WorktreeMeta | undefined,
  newId: string,
  newFullId: string
): WorktreeMeta {
  return {
    baseBranch: meta?.baseBranch ?? worktree.baseBranch ?? "",
    baseCommit: meta?.baseCommit ?? worktree.baseCommit ?? "",
    createdAt: meta?.createdAt ?? worktree.createdAt,
    prNumber: meta?.prNumber ?? worktree.prNumber,
    prUrl: meta?.prUrl ?? worktree.prUrl,
    id: newId,
    fullId: newFullId,
  };
}

export async function renameCurrentWorktree(
  newIdInput: string,
  cwd: string = process.cwd()
): Promise<RenameWorktreeResult> {
  const newId = normalizeWorktreeId(newIdInput);
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);
  const currentWorktree = findCurrentWorktree(worktrees, context.cwd);

  if (!currentWorktree) {
    throw new AppError("Current directory is not inside a git worktree");
  }

  if (currentWorktree.isMain) {
    throw new AppError("Cannot rename the main worktree");
  }

  const fullId = `${context.repoName}-${newId}`;
  assertIdAvailable(worktrees, currentWorktree, newId, fullId);

  const meta = await readWorktreeMeta(currentWorktree.path);
  await writeWorktreeMeta(
    currentWorktree.path,
    buildRenamedMeta(currentWorktree, meta, newId, fullId)
  );

  return {
    oldId: currentWorktree.id,
    newId,
    fullId,
    worktreePath: currentWorktree.path,
  };
}
