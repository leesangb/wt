import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import {
  buildWorktreeIdentifiers,
  buildWorktreePathCollisionSuffix,
  buildWorktreePathName,
  createWorktreeMeta,
} from "../../domain/worktree.js";
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
import {
  readWorktreeMeta,
  writeWorktreeMeta,
} from "../../infra/storage/worktree-meta-store.js";

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

function createScriptEnvironment(
  repoRoot: string,
  worktreePath: string,
  id: string,
  fullId: string,
  branchName: string
): Record<string, string> {
  return {
    WT_PATH: worktreePath,
    WT_ID: id,
    WT_FULL_ID: fullId,
    WT_BRANCH: branchName,
    WT_REPO_ROOT: repoRoot,
  };
}

async function canReuseWorktreePath(
  repoName: string,
  worktreePath: string,
  id: string
): Promise<boolean> {
  if (!existsSync(worktreePath)) {
    return true;
  }

  const meta = await readWorktreeMeta(worktreePath);

  if (!meta) {
    return false;
  }

  return buildWorktreeIdentifiers(repoName, worktreePath, meta).id === id;
}

async function resolveWorktreePath(
  worktreeBaseDir: string,
  repoName: string,
  id: string
): Promise<string> {
  const basePath = join(worktreeBaseDir, buildWorktreePathName(repoName, id));

  if (await canReuseWorktreePath(repoName, basePath, id)) {
    return basePath;
  }

  const collisionSuffix = buildWorktreePathCollisionSuffix(id);
  let attempt = 0;

  while (true) {
    const suffix =
      attempt === 0 ? collisionSuffix : `${collisionSuffix}-${attempt + 1}`;
    const candidatePath = join(
      worktreeBaseDir,
      buildWorktreePathName(repoName, id, suffix)
    );

    if (await canReuseWorktreePath(repoName, candidatePath, id)) {
      return candidatePath;
    }

    attempt += 1;
  }
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
  const id = options.id ?? branchName;
  const fullId = `${context.repoName}-${id}`;
  const worktreeBaseDir = resolveWorktreeDir(
    settings.worktreeDir,
    context.repoRoot
  );

  if (!existsSync(worktreeBaseDir)) {
    mkdirSync(worktreeBaseDir, { recursive: true });
  }

  const worktreePath = await resolveWorktreePath(
    worktreeBaseDir,
    context.repoName,
    id
  );

  await fetchRemote(context.repoRoot);

  const baseCommit = await getCommitHash(context.repoRoot, baseBranch);
  const scriptEnv = createScriptEnvironment(
    context.repoRoot,
    worktreePath,
    id,
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
    createWorktreeMeta(baseBranch, baseCommit, undefined, {
      id,
      fullId,
    })
  );

  if (settings.scripts.post.length === 0) {
    return {
      branchName,
      id,
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
      id,
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
    id,
    fullId,
    worktreePath,
    baseBranch,
    baseCommit,
    postMode: "sync",
  };
}
