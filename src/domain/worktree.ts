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
  isMain: boolean;
}

export interface WorktreeInfo {
  id: string;
  fullId: string;
  path: string;
  branch: string;
  isMain?: boolean;
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

export type WorktreeMergeStatus = "merged" | "not_merged" | "unknown";

export interface WorktreeRemovalInfo extends WorktreeInfo {
  mergeStatus: WorktreeMergeStatus;
}

export function toWorktreePathSegment(value: string): string {
  return value.replaceAll("/", "-");
}

export function buildWorktreePathCollisionSuffix(value: string): string {
  let hash = 2166136261;

  for (const char of value) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

export function buildWorktreePathName(
  repoName: string,
  id: string,
  suffix?: string
): string {
  const baseName = `${repoName}-${toWorktreePathSegment(id)}`;

  if (!suffix) {
    return baseName;
  }

  return `${baseName}-${suffix}`;
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
