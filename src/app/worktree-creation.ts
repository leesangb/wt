import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { WtSettings } from "../domain/settings.js";
import {
  buildWorktreePathCollisionSuffix,
  buildWorktreePathName,
} from "../domain/worktree.js";
import {
  executeScripts,
  executeScriptsDetached,
} from "../infra/scripts/runner.js";

export interface CreateWorktreeResult {
  branchName: string;
  id: string;
  fullId: string;
  worktreePath: string;
  baseBranch: string;
  baseCommit: string;
  idAdjustedFrom?: string;
  reusedExisting?: boolean;
  postMode?: "sync" | "async";
  postTask?: {
    pid: number;
    statusFilePath: string;
    logFilePath: string;
  };
}

export function ensureWorktreeBaseDir(worktreeBaseDir: string): void {
  if (!existsSync(worktreeBaseDir)) {
    mkdirSync(worktreeBaseDir, { recursive: true });
  }
}

export function createScriptEnvironment(
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

export async function runPreCreationScripts(
  settings: WtSettings,
  repoRoot: string,
  scriptEnv: Record<string, string>
): Promise<void> {
  if (settings.scripts.pre.length === 0) {
    return;
  }

  await executeScripts(settings.scripts.pre, repoRoot, scriptEnv);
}

export async function runPostCreationScripts(
  settings: WtSettings,
  worktreePath: string,
  scriptEnv: Record<string, string>
): Promise<Pick<CreateWorktreeResult, "postMode" | "postTask">> {
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

export function resolveFreshWorktreePath(
  worktreeBaseDir: string,
  repoName: string,
  id: string
): string {
  const basePath = join(worktreeBaseDir, buildWorktreePathName(repoName, id));

  if (!existsSync(basePath)) {
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

    if (!existsSync(candidatePath)) {
      return candidatePath;
    }

    attempt += 1;
  }
}

export function resolveUniqueWorktreeId(
  preferredId: string,
  existingIds: string[]
): Pick<CreateWorktreeResult, "id" | "idAdjustedFrom"> {
  const usedIds = new Set(existingIds);

  if (!usedIds.has(preferredId)) {
    return { id: preferredId };
  }

  let attempt = 1;

  while (usedIds.has(`${preferredId}-${attempt}`)) {
    attempt += 1;
  }

  return {
    id: `${preferredId}-${attempt}`,
    idAdjustedFrom: preferredId,
  };
}
