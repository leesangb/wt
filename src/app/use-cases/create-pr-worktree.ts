import { createWorktreeMeta } from "../../domain/worktree.js";
import {
  createScriptEnvironment,
  ensureWorktreeBaseDir,
  resolveFreshWorktreePath,
  runPostCreationScripts,
  runPreCreationScripts,
  type CreateWorktreeResult,
} from "../worktree-creation.js";
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
  createOrAttachGitWorktree,
  fetchRemote,
} from "../../infra/git/worktree-repository.js";
import { getCommitHash } from "../../infra/git/status.js";
import { writeWorktreeMeta } from "../../infra/storage/worktree-meta-store.js";
import { AppError } from "../errors.js";

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
): Promise<CreateWorktreeResult> {
  const prNumber = normalizePullRequestNumber(pullRequestNumber);
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
  const id = branchName;
  const fullId = `${context.repoName}-${id}`;
  const worktreeBaseDir = resolveWorktreeDir(
    settings.worktreeDir,
    context.repoRoot
  );

  ensureWorktreeBaseDir(worktreeBaseDir);
  await fetchRemote(context.repoRoot);

  const baseBranch = pullRequestInfo.baseRefName;
  const baseCommit = await getCommitHash(context.repoRoot, baseBranch);
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
  await createOrAttachGitWorktree(
    context.repoRoot,
    worktreePath,
    branchName,
    baseBranch
  );
  await checkoutPullRequest(worktreePath, prNumber);
  await writeWorktreeMeta(
    worktreePath,
    createWorktreeMeta(baseBranch, baseCommit, undefined, {
      id,
      fullId,
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
    ...postScriptResult,
  };
}
