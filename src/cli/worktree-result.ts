import type { CreateWorktreeResult } from "../app/worktree-creation.js";

export interface WorktreeCommandResult {
  id: string;
  fullId: string;
  path: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  reusedExisting: boolean;
  idAdjustedFrom?: string;
  postTask?: CreateWorktreeResult["postTask"];
}

export function toWorktreeCommandResult(
  result: CreateWorktreeResult
): WorktreeCommandResult {
  return {
    id: result.id,
    fullId: result.fullId,
    path: result.worktreePath,
    branch: result.branchName,
    baseBranch: result.baseBranch,
    baseCommit: result.baseCommit,
    reusedExisting: result.reusedExisting === true,
    ...(result.idAdjustedFrom
      ? { idAdjustedFrom: result.idAdjustedFrom }
      : {}),
    ...(result.postTask ? { postTask: result.postTask } : {}),
  };
}

export function printWorktreeCommandResult(
  result: CreateWorktreeResult
): void {
  console.log(JSON.stringify(toWorktreeCommandResult(result)));
}
