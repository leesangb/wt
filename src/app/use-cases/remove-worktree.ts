import { join } from "path";
import { AppError } from "../errors.js";
import { isPathInside } from "../../domain/path.js";
import { resolveWorktreeTarget } from "../../domain/worktree-target.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import {
  deleteBranch,
  listGitWorktreePaths,
  removeGitWorktree,
} from "../../infra/git/worktree-repository.js";
import {
  getWorktreeRemovalStatusSummary,
  getWorktreeStatusEntries,
} from "../../infra/git/status.js";
import {
  executeDetachedTask,
  shellEscapeSingle,
} from "../../infra/scripts/runner.js";
import { ensureRemoveTaskArtifactsIgnored } from "../../infra/storage/settings-store.js";
import type { WorktreeInfo } from "../../domain/worktree.js";

export interface RemoveWorktreeOptions {
  keepBranch?: boolean;
}

export interface RemoveWorktreePreview {
  worktree: WorktreeInfo;
  isCurrent: boolean;
  localCommitCount: number;
  localChangeCount: number;
  hasUnknownLocalCommits: boolean;
  statusEntries?: string[];
  remainingStatusEntryCount?: number;
}

export interface InspectRemoveWorktreeOptions {
  includeStatusEntries?: boolean;
  statusEntryLimit?: number;
}

export interface RemoveWorktreeResult {
  worktree: WorktreeInfo;
  branchDeleted: boolean;
  relocatedToPath?: string;
}

export interface BackgroundRemoveWorktreeResult {
  worktree: WorktreeInfo;
  branchDeleteQueued: boolean;
  relocatedToPath: string;
  pid: number;
  statusFilePath: string;
  logFilePath: string;
}

export class RemoveWorktreeError extends AppError {
  readonly relocatedToPath?: string;

  constructor(message: string, relocatedToPath?: string) {
    super(message);
    this.name = "RemoveWorktreeError";
    this.relocatedToPath = relocatedToPath;
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function findCurrentWorktree(
  worktrees: WorktreeInfo[],
  cwd: string
): WorktreeInfo | undefined {
  return worktrees
    .filter((worktree) => isPathInside(worktree.path, cwd))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

async function resolveRemovalTarget(
  target: string,
  cwd: string
): Promise<{
  context: Awaited<ReturnType<typeof requireRepositoryContext>>;
  worktree: WorktreeInfo;
}> {
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);

  if (target === ".") {
    const currentWorktree = findCurrentWorktree(worktrees, context.cwd);

    if (!currentWorktree) {
      throw new AppError("Current directory is not inside a git worktree");
    }

    return {
      context,
      worktree: currentWorktree,
    };
  }

  const result = resolveWorktreeTarget(worktrees, target, {
    allowPartialPath: true,
  });

  if (!result.worktree) {
    throw new AppError(
      result.error?.replace('target "', 'ID "') ??
        `Worktree with ID "${target}" not found`
    );
  }

  return {
    context,
    worktree: result.worktree,
  };
}

async function findSafeRemovalRoot(
  context: Awaited<ReturnType<typeof requireRepositoryContext>>,
  worktree: WorktreeInfo
): Promise<{
  gitRoot: string;
  relocatedToPath?: string;
}> {
  if (!isPathInside(worktree.path, context.cwd)) {
    return {
      gitRoot: context.repoRoot,
    };
  }

  const worktrees = await listGitWorktreePaths(context.repoRoot);
  const safeWorktree =
    worktrees.find(
      (candidate) => candidate.isMain && candidate.path !== worktree.path
    ) ??
    worktrees.find((candidate) => candidate.path !== worktree.path);

  if (!safeWorktree) {
    throw new AppError(
      "Could not find another worktree to remove this worktree safely"
    );
  }

  return {
    gitRoot: safeWorktree.path,
    relocatedToPath: safeWorktree.path,
  };
}

async function resolveSafeRemovalRoot(
  context: Awaited<ReturnType<typeof requireRepositoryContext>>,
  worktree: WorktreeInfo
): Promise<{
  gitRoot: string;
  relocatedToPath?: string;
}> {
  const removalRoot = await findSafeRemovalRoot(context, worktree);

  if (removalRoot.relocatedToPath) {
    process.chdir(removalRoot.relocatedToPath);
  }

  return removalRoot;
}

function normalizeTaskPathSegment(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "worktree"
  );
}

function buildRemovalTaskPaths(
  safeWorktreePath: string,
  worktree: WorktreeInfo
): {
  statusFilePath: string;
  logFilePath: string;
} {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const taskName = `remove-task-${normalizeTaskPathSegment(worktree.id)}-${timestamp}`;
  const wtDir = join(safeWorktreePath, ".wt");

  return {
    statusFilePath: join(wtDir, `${taskName}.json`),
    logFilePath: join(wtDir, `${taskName}.log`),
  };
}

function buildRemovalTaskScripts(
  removalRoot: string,
  worktree: WorktreeInfo,
  options: RemoveWorktreeOptions
): string[] {
  const scripts = [
    `printf '%s\n' 'Removing worktree ${shellEscapeSingle(worktree.path)}'`,
    [
      `git -C '${shellEscapeSingle(removalRoot)}' worktree remove`,
      `'${shellEscapeSingle(worktree.path)}' --force`,
    ].join(" "),
  ];

  if (!options.keepBranch && worktree.branch) {
    scripts.push(
      `printf '%s\n' 'Deleting branch ${shellEscapeSingle(worktree.branch)}'`,
      [
        `git -C '${shellEscapeSingle(removalRoot)}' branch -D --`,
        `'${shellEscapeSingle(worktree.branch)}'`,
      ].join(" ")
    );
  }

  return scripts;
}

function buildRemovalStartNotification(worktree: WorktreeInfo) {
  return {
    title: "wt",
    message: `${worktree.id} removal started`,
    subtitle: "Worktree removal running",
  };
}

function buildRemovalCompletionNotification(worktree: WorktreeInfo) {
  return {
    title: "wt",
    successMessage: `${worktree.id} removal finished`,
    successSubtitle: "Worktree removed - log saved",
    failureMessage: `${worktree.id} removal failed`,
    failureSubtitle: "Check removal log",
  };
}

export async function inspectRemoveWorktree(
  target: string,
  cwd: string = process.cwd(),
  options: InspectRemoveWorktreeOptions = {}
): Promise<RemoveWorktreePreview> {
  const { context, worktree } = await resolveRemovalTarget(target, cwd);
  const {
    localCommitCount,
    localChangeCount,
    hasUnknownLocalCommits,
  } = await getWorktreeRemovalStatusSummary(
    context.repoRoot,
    worktree.path,
    worktree.branch,
    worktree.baseBranch
  );
  const statusEntriesResult = options.includeStatusEntries
    ? await getWorktreeStatusEntries(
        worktree.path,
        options.statusEntryLimit ?? 8
      )
    : undefined;

  return {
    worktree,
    isCurrent: isPathInside(worktree.path, context.cwd),
    localCommitCount,
    localChangeCount,
    hasUnknownLocalCommits,
    ...(statusEntriesResult
      ? {
          statusEntries: statusEntriesResult.entries,
          remainingStatusEntryCount: Math.max(
            statusEntriesResult.totalCount - statusEntriesResult.entries.length,
            0
          ),
        }
      : {}),
  };
}

export async function removeWorktree(
  target: string,
  options: RemoveWorktreeOptions,
  cwd: string = process.cwd()
): Promise<RemoveWorktreeResult> {
  const { context, worktree } = await resolveRemovalTarget(target, cwd);
  const removalRoot = await resolveSafeRemovalRoot(context, worktree);

  await removeGitWorktree(removalRoot.gitRoot, worktree.path);

  if (options.keepBranch) {
    return {
      worktree,
      branchDeleted: false,
      relocatedToPath: removalRoot.relocatedToPath,
    };
  }

  if (!worktree.branch) {
    return {
      worktree,
      branchDeleted: false,
      relocatedToPath: removalRoot.relocatedToPath,
    };
  }

  try {
    await deleteBranch(removalRoot.gitRoot, worktree.branch);
  } catch (error) {
    throw new RemoveWorktreeError(
      getErrorMessage(error),
      removalRoot.relocatedToPath
    );
  }

  return {
    worktree,
    branchDeleted: true,
    relocatedToPath: removalRoot.relocatedToPath,
  };
}

export async function removeCurrentWorktreeInBackground(
  target: string,
  options: RemoveWorktreeOptions,
  cwd: string = process.cwd()
): Promise<BackgroundRemoveWorktreeResult> {
  const { context, worktree } = await resolveRemovalTarget(target, cwd);

  if (!isPathInside(worktree.path, context.cwd)) {
    throw new AppError(
      "Background removal is only available for the current worktree"
    );
  }

  const removalRoot = await findSafeRemovalRoot(context, worktree);

  if (!removalRoot.relocatedToPath) {
    throw new AppError(
      "Could not find another worktree to remove this worktree safely"
    );
  }

  await ensureRemoveTaskArtifactsIgnored(removalRoot.relocatedToPath);

  const { statusFilePath, logFilePath } = buildRemovalTaskPaths(
    removalRoot.relocatedToPath,
    worktree
  );
  const scripts = buildRemovalTaskScripts(
    removalRoot.gitRoot,
    worktree,
    options
  );
  const pid = executeDetachedTask({
    scripts,
    cwd: removalRoot.gitRoot,
    env: {
      WT_ID: worktree.id,
      WT_PATH: worktree.path,
      ...(worktree.branch ? { WT_BRANCH: worktree.branch } : {}),
    },
    statusFilePath,
    logFilePath,
    statusMetadata: {
      kind: "remove-worktree",
      worktreeId: worktree.id,
      worktreePath: worktree.path,
      branch: worktree.branch,
    },
    startNotification:
      process.platform === "darwin"
        ? buildRemovalStartNotification(worktree)
        : undefined,
    completionNotification:
      process.platform === "darwin"
        ? buildRemovalCompletionNotification(worktree)
        : undefined,
  });

  return {
    worktree,
    branchDeleteQueued: Boolean(worktree.branch && !options.keepBranch),
    relocatedToPath: removalRoot.relocatedToPath,
    pid,
    statusFilePath,
    logFilePath,
  };
}
