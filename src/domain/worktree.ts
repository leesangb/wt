import { basename } from "path";

export interface WorktreeMeta {
  baseBranch: string;
  baseCommit: string;
  createdAt: string;
  id?: string;
  fullId?: string;
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

export function toWorktreePathSegment(value: string): string {
  return value.replaceAll("/", "-");
}

export function buildWorktreePathName(repoName: string, id: string): string {
  return `${repoName}-${toWorktreePathSegment(id)}`;
}

export function buildWorktreeIdentifiers(
  repoName: string,
  worktreePath: string,
  meta?: Pick<WorktreeMeta, "id" | "fullId">
): Pick<WorktreeInfo, "id" | "fullId"> {
  if (meta?.id) {
    return {
      id: meta.id,
      fullId: meta.fullId ?? `${repoName}-${meta.id}`,
    };
  }

  if (meta?.fullId) {
    const id = meta.fullId.startsWith(`${repoName}-`)
      ? meta.fullId.substring(repoName.length + 1)
      : meta.fullId;

    return {
      id,
      fullId: meta.fullId,
    };
  }

  const fullId = basename(worktreePath);
  const id = fullId.startsWith(`${repoName}-`)
    ? fullId.substring(repoName.length + 1)
    : fullId;

  return { id, fullId };
}

export function createWorktreeMeta(
  baseBranch: string,
  baseCommit: string,
  createdAt: string = new Date().toISOString(),
  identifiers?: Pick<WorktreeInfo, "id" | "fullId">
): WorktreeMeta {
  return {
    baseBranch,
    baseCommit,
    createdAt,
    ...identifiers,
  };
}
