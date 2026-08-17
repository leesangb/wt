import {
  createPreparedWorktree,
  type CreateWorktreeResult,
} from "../worktree-creation.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import {
  ensureGithubCliReady,
  getPullRequestInfo,
  type PullRequestInfo,
} from "../../infra/github/cli.js";
import { loadSettings } from "../../infra/storage/settings-store.js";
import { AppError } from "../errors.js";

export interface CreatePrWorktreeResult extends CreateWorktreeResult {
  pullRequest: Pick<PullRequestInfo, "author" | "title"> & {
    issuePattern?: string;
  };
}

function normalizePullRequestNumber(pullRequestNumber: string): string {
  const value = pullRequestNumber.trim();

  if (!/^\d+$/.test(value)) {
    throw new AppError("Pull request number must be numeric");
  }

  return value;
}

export async function createPrWorktree(
  pullRequestNumber: string,
  cwd: string = process.cwd()
): Promise<CreatePrWorktreeResult> {
  const prNumber = normalizePullRequestNumber(pullRequestNumber);
  const context = await requireRepositoryContext(cwd);
  await ensureGithubCliReady(context.repoRoot);
  const [pullRequest, settings, worktrees] = await Promise.all([
    getPullRequestInfo(context.repoRoot, prNumber),
    loadSettings(context.repoRoot),
    loadWorktreeInfos(context),
  ]);
  const pullRequestSummary = {
    author: pullRequest.author,
    title: pullRequest.title,
    ...(settings.issue?.pattern
      ? { issuePattern: settings.issue.pattern }
      : {}),
  };
  const existingWorktree = worktrees.find(
    (worktree) => worktree.branch === pullRequest.headRefName
  );

  if (existingWorktree) {
    return {
      branchName: pullRequest.headRefName,
      id: existingWorktree.id,
      fullId: existingWorktree.fullId,
      worktreePath: existingWorktree.path,
      baseBranch: existingWorktree.baseBranch ?? "",
      baseCommit: existingWorktree.baseCommit ?? "",
      reusedExisting: true,
      pullRequest: pullRequestSummary,
    };
  }

  const worktree = await createPreparedWorktree({
    kind: "pull-request",
    context,
    pullRequest,
    existingIds: worktrees.map((worktree) => worktree.id),
  });

  return { ...worktree, pullRequest: pullRequestSummary };
}
