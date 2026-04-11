import { createWorktreeMeta } from "../../domain/worktree.js";
import {
  createScriptEnvironment,
  ensureWorktreeBaseDir,
  resolveFreshWorktreePath,
  runPostCreationScripts,
  runPreCreationScripts,
  resolveUniqueWorktreeId,
  type CreateWorktreeResult,
} from "../worktree-creation.js";
import { copyConfiguredPaths } from "../worktree-copy.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import {
  loadSettings,
  resolveWorktreeDir,
} from "../../infra/storage/settings-store.js";
import {
  checkoutPullRequest,
  ensureGithubCliReady,
  getPullRequestInfo,
} from "../../infra/github/cli.js";
import {
  createDetachedGitWorktree,
  deleteBranch,
  fetchRemote,
  fetchRemoteBranch,
  localBranchExists,
  removeGitWorktree,
} from "../../infra/git/worktree-repository.js";
import {
  isRefAncestor,
  resolveCommitHash,
} from "../../infra/git/status.js";
import { writeWorktreeMeta } from "../../infra/storage/worktree-meta-store.js";
import { AppError } from "../errors.js";

function normalizePullRequestNumber(pullRequestNumber: string): string {
  const value = pullRequestNumber.trim();

  if (!/^\d+$/.test(value)) {
    throw new AppError("Pull request number must be numeric");
  }

  return value;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function resolvePrBaseCommit(
  repoRoot: string,
  baseBranch: string
): Promise<string> {
  const initialResolution = await resolveCommitHash(repoRoot, [
    baseBranch,
    `origin/${baseBranch}`,
    `refs/remotes/origin/${baseBranch}`,
  ]);

  if (initialResolution) {
    return initialResolution.commitHash;
  }

  await fetchRemoteBranch(repoRoot, baseBranch);

  const fetchedResolution = await resolveCommitHash(repoRoot, [
    `origin/${baseBranch}`,
    `refs/remotes/origin/${baseBranch}`,
    baseBranch,
  ]);

  if (fetchedResolution) {
    return fetchedResolution.commitHash;
  }

  throw new AppError(
    `Could not resolve PR base branch ${baseBranch} from origin. Fetch it manually or confirm the branch still exists.`
  );
}

export async function createPrWorktree(
  pullRequestNumber: string,
  cwd: string = process.cwd()
): Promise<CreateWorktreeResult> {
  const prNumber = normalizePullRequestNumber(pullRequestNumber);
  const preferredId = `pr-${prNumber}`;
  const context = await requireRepositoryContext(cwd);
  await ensureGithubCliReady(context.repoRoot);
  const pullRequestInfo = await getPullRequestInfo(context.repoRoot, prNumber);
  const branchName = pullRequestInfo.headRefName;
  const worktrees = await loadWorktreeInfos(context);
  const existingWorktree = worktrees.find(
    (worktree) => worktree.branch === branchName
  );

  if (existingWorktree) {
    return {
      branchName,
      id: existingWorktree.id,
      fullId: existingWorktree.fullId,
      worktreePath: existingWorktree.path,
      baseBranch: existingWorktree.baseBranch ?? "",
      baseCommit: existingWorktree.baseCommit ?? "",
      reusedExisting: true,
    };
  }

  const settings = await loadSettings(context.repoRoot);
  const { id, idAdjustedFrom } = resolveUniqueWorktreeId(
    preferredId,
    worktrees.map((worktree) => worktree.id)
  );
  const fullId = `${context.repoName}-${id}`;
  const worktreeBaseDir = resolveWorktreeDir(
    settings.worktreeDir,
    context.repoRoot
  );

  ensureWorktreeBaseDir(worktreeBaseDir);
  await fetchRemote(context.repoRoot);

  const baseBranch = pullRequestInfo.baseRefName;
  const baseCommit = await resolvePrBaseCommit(context.repoRoot, baseBranch);
  const branchExistedBeforeCheckout = await localBranchExists(
    context.repoRoot,
    branchName
  );

  if (
    branchExistedBeforeCheckout &&
    !(await isRefAncestor(
      context.repoRoot,
      branchName,
      pullRequestInfo.headRefOid
    ))
  ) {
    throw new AppError(
      `Local branch ${branchName} already exists but diverges from PR #${prNumber}. Refusing to reset it automatically; delete or rename the local branch, or merge/rebase it manually first.`
    );
  }

  const worktreePath = resolveFreshWorktreePath(
    worktreeBaseDir,
    context.repoName,
    id
  );
  const scriptEnv = createScriptEnvironment(
    context.repoRoot,
    worktreePath,
    id,
    fullId,
    branchName
  );

  await runPreCreationScripts(settings, context.repoRoot, scriptEnv);
  await createDetachedGitWorktree(
    context.repoRoot,
    worktreePath,
    baseCommit
  );

  try {
    await checkoutPullRequest(worktreePath, prNumber);
  } catch (error) {
    const cleanupErrors: string[] = [];

    try {
      await removeGitWorktree(context.repoRoot, worktreePath);
    } catch (cleanupError) {
      cleanupErrors.push(
        `remove worktree: ${getErrorMessage(cleanupError)}`
      );
    }

    if (!branchExistedBeforeCheckout) {
      try {
        if (await localBranchExists(context.repoRoot, branchName)) {
          await deleteBranch(context.repoRoot, branchName);
        }
      } catch (cleanupError) {
        cleanupErrors.push(
          `delete branch ${branchName}: ${getErrorMessage(cleanupError)}`
        );
      }
    }

    if (cleanupErrors.length > 0) {
      throw new AppError(
        `${getErrorMessage(error)}\nCleanup failed for temporary PR worktree ${worktreePath}: ${cleanupErrors.join("; ")}`
      );
    }

    throw error;
  }

  await copyConfiguredPaths(settings, context.repoRoot, worktreePath);

  await writeWorktreeMeta(
    worktreePath,
    createWorktreeMeta(baseBranch, baseCommit, undefined, {
      id,
      fullId,
      prNumber: pullRequestInfo.number,
      prUrl: pullRequestInfo.url,
    })
  );

  const postScriptResult = await runPostCreationScripts(
    settings,
    worktreePath,
    scriptEnv
  );

  return {
    branchName,
    id,
    fullId,
    worktreePath,
    baseBranch,
    baseCommit,
    idAdjustedFrom,
    ...postScriptResult,
  };
}
