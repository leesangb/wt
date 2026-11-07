import { AppError } from "../errors.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos, loadWorktreeRemovalInfos } from "../worktree-catalog.js";
import { getGoneUpstreamBranchesResult } from "../../infra/git/status.js";
import type { WorktreeRemovalInfo } from "../../domain/worktree.js";
import { createRemovalPreviewInspector, type RemovalPreviewInspector } from "./remove-worktree.js";

export interface CleanWorktreeFilters {
  merged?: boolean;
  remoteDeleted?: boolean;
}

export type CleanWorktreeReason = "merged" | "remote_deleted";

export interface CleanWorktreeCandidate {
  worktree: WorktreeRemovalInfo;
  reasons: CleanWorktreeReason[];
}

export interface CleanWorktreePlan {
  repoName: string;
  candidates: CleanWorktreeCandidate[];
  inspectPreview: RemovalPreviewInspector;
}

export interface PlanWorktreeCleanupOptions {
  includeAllCandidates?: boolean;
}

function hasAnyFilter(filters: CleanWorktreeFilters): boolean {
  return filters.merged === true || filters.remoteDeleted === true;
}

function resolveCandidateReasons(
  worktree: WorktreeRemovalInfo,
  filters: CleanWorktreeFilters,
  goneUpstreamBranches: Set<string>
): CleanWorktreeReason[] {
  const reasons: CleanWorktreeReason[] = [];

  if (filters.merged && worktree.mergeStatus === "merged") {
    reasons.push("merged");
  }

  if (
    filters.remoteDeleted &&
    worktree.branch &&
    goneUpstreamBranches.has(worktree.branch)
  ) {
    reasons.push("remote_deleted");
  }

  return reasons;
}

export async function planWorktreeCleanup(
  filters: CleanWorktreeFilters,
  cwd: string = process.cwd(),
  options: PlanWorktreeCleanupOptions = {}
): Promise<CleanWorktreePlan> {
  const hasFilters = hasAnyFilter(filters);
  const includeAllCandidates = options.includeAllCandidates === true;

  if (!hasFilters && !includeAllCandidates) {
    throw new AppError(
      "wt clean requires at least one filter. Use --merged and/or --remote-deleted."
    );
  }

  const context = await requireRepositoryContext(cwd);
  const worktrees: WorktreeRemovalInfo[] = filters.merged
    ? await loadWorktreeRemovalInfos(context)
    : (await loadWorktreeInfos(context)).map(worktree => ({ ...worktree, mergeStatus: "unknown" }));
  const visibleWorktrees = worktrees.filter(worktree => !worktree.isMain);
  const goneUpstreamBranches = filters.remoteDeleted
    ? (await getGoneUpstreamBranchesResult(
        context.repoRoot,
        visibleWorktrees.flatMap(worktree => worktree.branch ? [worktree.branch] : [])
      )).branches
    : new Set<string>();

  const candidates = visibleWorktrees
    .map((worktree) => ({
      worktree,
      reasons: resolveCandidateReasons(
        worktree,
        filters,
        goneUpstreamBranches
      ),
    }))
    .filter((candidate) => includeAllCandidates || candidate.reasons.length > 0);

  return {
    repoName: context.repoName,
    candidates,
    inspectPreview: createRemovalPreviewInspector(context, worktrees),
  };
}
