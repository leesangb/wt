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
import { loadRepositorySettings } from "../repository-settings.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import {
  resolveWorktreeDir,
} from "../../infra/storage/settings-store.js";
import {
  attachGitWorktree,
  localBranchExists,
} from "../../infra/git/worktree-repository.js";
import { getCommitHash, getMergeBase } from "../../infra/git/status.js";
import { writeWorktreeMeta } from "../../infra/storage/worktree-meta-store.js";
import { AppError } from "../errors.js";

function normalizeBranchName(branchName: string): string {
  const value = branchName.trim();

  if (!value) {
    throw new AppError("Branch name is required");
  }

  return value;
}

export async function createBranchWorktree(
  branchName: string,
  cwd: string = process.cwd()
): Promise<CreateWorktreeResult> {
  const normalizedBranchName = normalizeBranchName(branchName);
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);
  const existingWorktree = worktrees.find(
    (worktree) => worktree.branch === normalizedBranchName
  );

  if (existingWorktree) {
    return {
      branchName: normalizedBranchName,
      id: existingWorktree.id,
      fullId: existingWorktree.fullId,
      worktreePath: existingWorktree.path,
      baseBranch: existingWorktree.baseBranch ?? "",
      baseCommit: existingWorktree.baseCommit ?? "",
      reusedExisting: true,
    };
  }

  if (!(await localBranchExists(context.repoRoot, normalizedBranchName))) {
    throw new AppError(
      `Local branch ${normalizedBranchName} does not exist. Use "wt new ${normalizedBranchName}" to create it first.`
    );
  }

  const { settings, worktreeDirRoot } = await loadRepositorySettings(
    context.repoRoot
  );
  const { id, idAdjustedFrom } = resolveUniqueWorktreeId(
    normalizedBranchName,
    worktrees.map((worktree) => worktree.id)
  );
  const fullId = `${context.repoName}-${id}`;
  const worktreeBaseDir = resolveWorktreeDir(
    settings.worktreeDir,
    worktreeDirRoot
  );

  ensureWorktreeBaseDir(worktreeBaseDir);

  const worktreePath = resolveFreshWorktreePath(
    worktreeBaseDir,
    context.repoName,
    id
  );
  const baseBranch = settings.baseBranch;
  const baseCommit =
    (await getMergeBase(
      context.repoRoot,
      normalizedBranchName,
      baseBranch
    )) || (await getCommitHash(context.repoRoot, baseBranch));
  const scriptEnv = createScriptEnvironment(
    context.repoRoot,
    worktreePath,
    id,
    fullId,
    normalizedBranchName
  );

  await runPreCreationScripts(settings, context.repoRoot, scriptEnv);
  await attachGitWorktree(context.repoRoot, worktreePath, normalizedBranchName);
  await copyConfiguredPaths(settings, context.repoRoot, worktreePath);

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
    branchName: normalizedBranchName,
    id,
    fullId,
    worktreePath,
    baseBranch,
    baseCommit,
    idAdjustedFrom,
    ...postScriptResult,
  };
}
