import type { WtIssueSettings } from "../../domain/settings.js";
import type { WorktreeInfo } from "../../domain/worktree.js";
import { buildIssueLink } from "../../domain/issue-link.js";
import { findPullRequestLinkForBranch } from "../../infra/github/cli.js";
import { AppError } from "../errors.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadRepositorySettings } from "../repository-settings.js";
import { loadCurrentWorktreeInfo } from "../worktree-catalog.js";

export interface GetCurrentWorktreeResult {
  repoName: string;
  worktree: WorktreeInfo;
}

function enrichWorktreeWithIssueLink(
  worktree: WorktreeInfo,
  issueSettings: WtIssueSettings | undefined
): WorktreeInfo {
  if (!issueSettings) {
    return worktree;
  }

  try {
    const issueLink = buildIssueLink(worktree.branch, issueSettings);

    if (!issueLink) {
      return worktree;
    }

    return {
      ...worktree,
      issueKey: issueLink.key,
      issueUrl: issueLink.url,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new AppError(
      `Invalid issue.pattern "${issueSettings.pattern}": ${message}`
    );
  }
}

async function enrichWorktreeWithPullRequest(
  repoRoot: string,
  worktree: WorktreeInfo
): Promise<WorktreeInfo> {
  if (worktree.prUrl || !worktree.branch || worktree.isDetached) {
    return worktree;
  }

  const pullRequest = await findPullRequestLinkForBranch(
    repoRoot,
    worktree.branch
  );

  if (!pullRequest) {
    return worktree;
  }

  return {
    ...worktree,
    prNumber: pullRequest.number,
    prUrl: pullRequest.url,
  };
}

export async function getCurrentWorktree(
  cwd: string = process.cwd()
): Promise<GetCurrentWorktreeResult> {
  const context = await requireRepositoryContext(cwd);
  const settings = await loadRepositorySettings(context.repoRoot);
  const worktree = enrichWorktreeWithIssueLink(
    await enrichWorktreeWithPullRequest(
      context.repoRoot,
      await loadCurrentWorktreeInfo(context)
    ),
    settings.issue
  );

  return {
    repoName: context.repoName,
    worktree,
  };
}
