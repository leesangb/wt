import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { createWorktreeMeta } from "../../domain/worktree.js";
import { requireRepositoryContext } from "../repository-context.js";
import {
  loadSettings,
  resolveWorktreeDir,
} from "../../infra/storage/settings-store.js";
import {
  createGitWorktree,
  fetchRemote,
} from "../../infra/git/worktree-repository.js";
import { getCommitHash } from "../../infra/git/status.js";
import {
  executeScripts,
  executeScriptsDetached,
} from "../../infra/scripts/runner.js";
import { generateShortId } from "../../utils/id.js";
import { writeWorktreeMeta } from "../../infra/storage/worktree-meta-store.js";

export interface CreateWorktreeOptions {
  base?: string;
  push?: boolean;
  id?: string;
}

export interface CreateWorktreeResult {
  branchName: string;
  shortId: string;
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

function createScriptEnvironment(
  repoRoot: string,
  worktreePath: string,
  shortId: string,
  fullId: string,
  branchName: string
): Record<string, string> {
  return {
    WT_PATH: worktreePath,
    WT_ID: shortId,
    WT_FULL_ID: fullId,
    WT_BRANCH: branchName,
    WT_REPO_ROOT: repoRoot,
  };
}

export async function createWorktree(
  branchName: string,
  options: CreateWorktreeOptions,
  cwd: string = process.cwd()
): Promise<CreateWorktreeResult> {
  const context = await requireRepositoryContext(cwd);
  const settings = await loadSettings(context.repoRoot);
  const baseBranch = options.base ?? settings.baseBranch;
  const pushRemote = options.push ?? settings.pushRemote;
  const shortId = options.id ?? generateShortId();
  const fullId = `${context.repoName}-${shortId}`;
  const worktreeBaseDir = resolveWorktreeDir(
    settings.worktreeDir,
    context.repoRoot
  );
  const worktreePath = join(worktreeBaseDir, fullId);

  if (!existsSync(worktreeBaseDir)) {
    mkdirSync(worktreeBaseDir, { recursive: true });
  }

  await fetchRemote(context.repoRoot);

  const baseCommit = await getCommitHash(context.repoRoot, baseBranch);
  const scriptEnv = createScriptEnvironment(
    context.repoRoot,
    worktreePath,
    shortId,
    fullId,
    branchName
  );

  if (settings.scripts.pre.length > 0) {
    await executeScripts(settings.scripts.pre, context.repoRoot, scriptEnv);
  }

  await createGitWorktree(
    context.repoRoot,
    worktreePath,
    branchName,
    baseBranch,
    pushRemote
  );

  await writeWorktreeMeta(
    worktreePath,
    createWorktreeMeta(baseBranch, baseCommit)
  );

  if (settings.scripts.post.length === 0) {
    return {
      branchName,
      shortId,
      fullId,
      worktreePath,
      baseBranch,
      baseCommit,
    };
  }

  if (settings.scripts.postMode === "async") {
    const wtDir = join(worktreePath, ".wt");
    const statusFilePath = join(wtDir, "post-task.json");
    const logFilePath = join(wtDir, "post-task.log");
    const pid = executeScriptsDetached(
      settings.scripts.post,
      worktreePath,
      scriptEnv,
      statusFilePath,
      logFilePath
    );

    return {
      branchName,
      shortId,
      fullId,
      worktreePath,
      baseBranch,
      baseCommit,
      postMode: "async",
      postTask: {
        pid,
        statusFilePath,
        logFilePath,
      },
    };
  }

  await executeScripts(settings.scripts.post, worktreePath, scriptEnv);

  return {
    branchName,
    shortId,
    fullId,
    worktreePath,
    baseBranch,
    baseCommit,
    postMode: "sync",
  };
}
