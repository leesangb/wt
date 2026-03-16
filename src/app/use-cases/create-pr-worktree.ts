import { AppError } from "../errors.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import {
  buildWorktreeScriptEnvironment,
  findReusableWorktree,
  prepareWorktreePlan,
  runConfiguredPostScripts,
  runConfiguredPreScripts,
  writeWorktreeMetadata,
} from "../worktree-creation.js";
import {
  checkoutPullRequest,
  GithubCliAuthenticationError,
  MissingGithubCliError,
  ensureGithubCliReady,
} from "../../infra/github/cli.js";
import { createOrAttachGitWorktree } from "../../infra/git/worktree-repository.js";
import type { CreateWorktreeResult } from "./create-worktree.js";

export interface CreatePullRequestWorktreeResult extends CreateWorktreeResult {
  pullRequestNumber: string;
  created: boolean;
}

function buildPullRequestBranchName(pullRequestNumber: string): string {
  return `pr-${pullRequestNumber}`;
}

export async function createPullRequestWorktree(
  pullRequestNumber: string,
  cwd: string = process.cwd()
): Promise<CreatePullRequestWorktreeResult> {
  const branchName = buildPullRequestBranchName(pullRequestNumber);

  try {
    const plan = await prepareWorktreePlan(
      branchName,
      {
        id: branchName,
      },
      cwd
    );

    await ensureGithubCliReady(plan.context.repoRoot);

    const existingWorktrees = await loadWorktreeInfos(plan.context);
    const mainWorktreeConflict = existingWorktrees.find(
      (worktree) => worktree.isMain && worktree.branch === branchName
    );

    if (mainWorktreeConflict) {
      throw new AppError(
        `The main worktree is already using branch ${branchName}. Switch it to a different branch before running \`wt pr ${pullRequestNumber}\`.`
      );
    }

    const reusableWorktree = findReusableWorktree(
      plan.context.repoName,
      existingWorktrees.filter((worktree) => !worktree.isMain),
      plan.id,
      branchName,
      plan.worktreePath
    );
    const worktreePath = reusableWorktree?.path ?? plan.worktreePath;
    const scriptEnv = buildWorktreeScriptEnvironment(
      plan.context.repoRoot,
      worktreePath,
      plan.id,
      plan.fullId,
      branchName
    );

    await runConfiguredPreScripts(plan.settings, plan.context.repoRoot, scriptEnv);

    if (!reusableWorktree) {
      await createOrAttachGitWorktree(
        plan.context.repoRoot,
        worktreePath,
        branchName,
        plan.baseBranch
      );
    }

    await checkoutPullRequest(worktreePath, pullRequestNumber, branchName);
    await writeWorktreeMetadata(
      worktreePath,
      plan.baseBranch,
      plan.baseCommit,
      {
        id: plan.id,
        fullId: plan.fullId,
      }
    );

    const postScripts = await runConfiguredPostScripts(
      plan.settings,
      worktreePath,
      scriptEnv
    );

    return {
      pullRequestNumber,
      created: !reusableWorktree,
      branchName,
      id: plan.id,
      fullId: plan.fullId,
      worktreePath,
      baseBranch: plan.baseBranch,
      baseCommit: plan.baseCommit,
      ...postScripts,
    };
  } catch (error) {
    if (error instanceof MissingGithubCliError) {
      throw new AppError(
        "GitHub CLI (`gh`) is required for `wt pr`. Install it from https://cli.github.com/"
      );
    }

    if (error instanceof GithubCliAuthenticationError) {
      throw new AppError(
        "GitHub CLI is not authenticated. Run `gh auth login` and try again."
      );
    }

    throw error;
  }
}
