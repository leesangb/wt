import { basename } from "path";

export interface WorktreeMeta {
  baseBranch: string;
  baseCommit: string;
  createdAt: string;
}

export interface GitWorktreeRef {
  path: string;
  branch: string;
}

export interface WorktreeInfo {
  id: string;
  fullId: string;
  path: string;
  branch: string;
  repoName: string;
  createdAt: string;
  baseBranch?: string;
  baseCommit?: string;
}

export interface WorktreeState extends WorktreeInfo {
  isCurrent: boolean;
  isMerged: boolean;
  unpushedCount: number;
  modifiedCount: number;
}

export function buildWorktreeIdentifiers(
  repoName: string,
  worktreePath: string
): Pick<WorktreeInfo, "id" | "fullId"> {
  const fullId = basename(worktreePath);
  const id = fullId.startsWith(`${repoName}-`)
    ? fullId.substring(repoName.length + 1)
    : fullId;

  return { id, fullId };
}

export function createWorktreeMeta(
  baseBranch: string,
  baseCommit: string,
  createdAt: string = new Date().toISOString()
): WorktreeMeta {
  return {
    baseBranch,
    baseCommit,
    createdAt,
  };
}
