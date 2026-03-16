import { createGitWorktree } from "../../infra/git/worktree-repository.js";
import {
  buildWorktreeScriptEnvironment,
  prepareWorktreePlan,
  runConfiguredPostScripts,
  runConfiguredPreScripts,
  writeWorktreeMetadata,
} from "../worktree-creation.js";

export interface CreateWorktreeOptions {
  base?: string;
  push?: boolean;
  id?: string;
}

export interface CreateWorktreeResult {
  branchName: string;
  id: string;
  fullId: string;
  worktreePath: string;
  baseBranch: string;
  baseCommit: string;
  postMode?: "sync" | "async";
  postTask?: {
    pid: number;
    statusFilePath: string;
    logFilePath: string;
  };
}

export async function createWorktree(
  branchName: string,
  options: CreateWorktreeOptions,
  cwd: string = process.cwd()
): Promise<CreateWorktreeResult> {
  const plan = await prepareWorktreePlan(
    branchName,
    {
      base: options.base,
      id: options.id,
    },
    cwd
  );
  const pushRemote = options.push ?? plan.settings.pushRemote;
  const scriptEnv = buildWorktreeScriptEnvironment(
    plan.context.repoRoot,
    plan.worktreePath,
    plan.id,
    plan.fullId,
    branchName
  );

  await runConfiguredPreScripts(plan.settings, plan.context.repoRoot, scriptEnv);

  await createGitWorktree(
    plan.context.repoRoot,
    plan.worktreePath,
    branchName,
    plan.baseBranch,
    pushRemote
  );

  await writeWorktreeMetadata(
    plan.worktreePath,
    plan.baseBranch,
    plan.baseCommit,
    {
      id: plan.id,
      fullId: plan.fullId,
    }
  );

  const postScripts = await runConfiguredPostScripts(
    plan.settings,
    plan.worktreePath,
    scriptEnv
  );

  return {
    branchName,
    id: plan.id,
    fullId: plan.fullId,
    worktreePath: plan.worktreePath,
    baseBranch: plan.baseBranch,
    baseCommit: plan.baseCommit,
    ...postScripts,
  };
}
