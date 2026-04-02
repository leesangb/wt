import { AppError } from "../errors.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeRemovalInfos } from "../worktree-catalog.js";
import { getGoneUpstreamBranchesResult } from "../../infra/git/status.js";
import type { WorktreeRemovalInfo } from "../../domain/worktree.js";

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
  const worktrees = (await loadWorktreeRemovalInfos(context)).filter(
    (worktree) => !worktree.isMain
  );
  const goneUpstreamResult = await getGoneUpstreamBranchesResult(
    context.repoRoot
  );
  const goneUpstreamBranches = goneUpstreamResult.known
    ? goneUpstreamResult.branches
    : new Set<string>();

  const candidates = worktrees
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
  };
}
