import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { WtSettings } from "../domain/settings.js";
import {
  buildWorktreeIdentifiers,
  buildWorktreePathCollisionSuffix,
  buildWorktreePathName,
  createWorktreeMeta,
  type WorktreeInfo,
} from "../domain/worktree.js";
import { requireRepositoryContext, type RepositoryContext } from "./repository-context.js";
import {
  loadSettings,
  resolveWorktreeDir,
} from "../infra/storage/settings-store.js";
import { fetchRemote } from "../infra/git/worktree-repository.js";
import { getCommitHash } from "../infra/git/status.js";
import {
  executeScripts,
  executeScriptsDetached,
} from "../infra/scripts/runner.js";
import {
  readWorktreeMeta,
  writeWorktreeMeta,
} from "../infra/storage/worktree-meta-store.js";

export interface WorktreeCreationPlan {
  context: RepositoryContext;
  settings: WtSettings;
  branchName: string;
  id: string;
  fullId: string;
  worktreePath: string;
  baseBranch: string;
  baseCommit: string;
}

export interface WorktreePostScriptsResult {
  postMode?: "sync" | "async";
  postTask?: {
    pid: number;
    statusFilePath: string;
    logFilePath: string;
  };
}

interface PrepareWorktreePlanOptions {
  base?: string;
  id?: string;
}

export function buildWorktreeScriptEnvironment(
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

export function findReusableWorktree(
  worktrees: WorktreeInfo[],
  id: string,
  branchName: string,
  worktreePath: string
): WorktreeInfo | undefined {
  return worktrees.find((worktree) => {
    return (
      worktree.id === id ||
      worktree.branch === branchName ||
      worktree.path === worktreePath
    );
  });
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

export async function prepareWorktreePlan(
  branchName: string,
  options: PrepareWorktreePlanOptions = {},
  cwd: string = process.cwd()
): Promise<WorktreeCreationPlan> {
  const context = await requireRepositoryContext(cwd);
  const settings = await loadSettings(context.repoRoot);
  const baseBranch = options.base ?? settings.baseBranch;
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

  return {
    context,
    settings,
    branchName,
    id,
    fullId,
    worktreePath,
    baseBranch,
    baseCommit,
  };
}

export async function runConfiguredPreScripts(
  settings: WtSettings,
  repoRoot: string,
  scriptEnv: Record<string, string>
): Promise<void> {
  if (settings.scripts.pre.length === 0) {
    return;
  }

  await executeScripts(settings.scripts.pre, repoRoot, scriptEnv);
}

export async function runConfiguredPostScripts(
  settings: WtSettings,
  worktreePath: string,
  scriptEnv: Record<string, string>
): Promise<WorktreePostScriptsResult> {
  if (settings.scripts.post.length === 0) {
    return {};
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
    postMode: "sync",
  };
}

export async function writeWorktreeMetadata(
  worktreePath: string,
  baseBranch: string,
  baseCommit: string,
  identifiers: Pick<WorktreeInfo, "id" | "fullId">
): Promise<void> {
  const existingMeta = await readWorktreeMeta(worktreePath);

  await writeWorktreeMeta(
    worktreePath,
    createWorktreeMeta(
      baseBranch,
      baseCommit,
      existingMeta?.createdAt,
      identifiers
    )
  );
}
