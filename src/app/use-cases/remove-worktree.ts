import { join } from "path";
import { AppError } from "../errors.js";
import { isPathInside } from "../../domain/path.js";
import { resolveWorktreeTarget } from "../../domain/worktree-target.js";
import { requireRepositoryContext } from "../repository-context.js";
import type { RepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import type { WtSettings } from "../../domain/settings.js";
import type { WorktreeInfo } from "../../domain/worktree.js";
import {
  deleteBranch,
  listGitWorktreePaths,
  removeGitWorktree,
} from "../../infra/git/worktree-repository.js";
import {
  getWorktreeRemovalStatusSummary,
  createWorktreeRemovalStatusReader,
  type WorktreeRemovalStatusSummary,
  type WorktreeRemovalStatusOptions,
} from "../../infra/git/status.js";
import {
  executeDetachedTask,
  shellEscapeSingle,
  type DetachedTaskOptions,
} from "../../infra/scripts/runner.js";
import {
  loadSettings,
} from "../../infra/storage/settings-store.js";
import { ensureRemoveTaskArtifactsExcluded } from "../../infra/git/exclude.js";
import { loadWorktreePlugins, type PluginWarning } from "../worktree-plugins.js";

export interface InspectRemovalOptions {
  includeStatusEntries?: boolean;
  statusEntryLimit?: number;
}

export type RemovalPreviewInspector = (
  worktreePath: string,
  options?: InspectRemovalOptions
) => Promise<RemovalPlan>;

export interface RemovalPlan {
  target: string;
  context: RepositoryContext;
  worktree: WorktreeInfo;
  isCurrent: boolean;
  localCommitCount: number;
  localChangeCount: number;
  hasUnknownLocalCommits: boolean;
  statusEntries?: string[];
  remainingStatusEntryCount?: number;
  removalRoot: {
    gitRoot: string;
    relocatedToPath?: string;
  };
  revision: string;
}

export interface ExecuteRemovalOptions {
  keepBranch?: boolean;
  execution: "auto" | "foreground";
}

export interface RemovedWorktreeResult {
  status: "removed";
  worktree: WorktreeInfo;
  branchDeleted: boolean;
  relocatedToPath?: string;
  warnings: PluginWarning[];
}

export interface BackgroundRemovalResult {
  status: "background_started";
  worktree: WorktreeInfo;
  branchDeleteQueued: boolean;
  relocatedToPath: string;
  pid: number;
  statusFilePath: string;
  logFilePath: string;
  warnings: PluginWarning[];
}

export interface BranchRemovalFailedResult {
  status: "worktree_removed_branch_failed";
  worktree: WorktreeInfo;
  relocatedToPath?: string;
  error: string;
  warnings: PluginWarning[];
}

export interface StaleRemovalPlanResult {
  status: "plan_stale";
  latestPlan?: RemovalPlan;
  reason: string;
}

export type RemovalResult =
  | RemovedWorktreeResult
  | BackgroundRemovalResult
  | BranchRemovalFailedResult
  | StaleRemovalPlanResult;

export interface WorktreeRemovalDependencies {
  repository: {
    requireContext: (cwd: string) => Promise<RepositoryContext>;
    loadWorktrees: (context: RepositoryContext) => Promise<WorktreeInfo[]>;
    listPaths: (
      repoRoot: string
    ) => Promise<Array<{ path: string; isMain: boolean }>>;
    createStatusReader?: typeof createWorktreeRemovalStatusReader;
    inspectStatus: (
      repoRoot: string,
      worktreePath: string,
      branch?: string,
      baseBranch?: string,
      options?: WorktreeRemovalStatusOptions
    ) => Promise<WorktreeRemovalStatusSummary>;
  };
  settings: {
    load: (repoRoot: string) => Promise<WtSettings>;
  };
  git: {
    ensureTaskArtifactsExcluded: (repoRoot: string) => Promise<void>;
    remove: (repoRoot: string, worktreePath: string) => Promise<void>;
    deleteBranch: (repoRoot: string, branch: string) => Promise<void>;
  };
  tasks: {
    start: (options: DetachedTaskOptions) => number;
  };
  plugins: typeof loadWorktreePlugins;
  runtime: {
    changeDirectory: (path: string) => void;
    now: () => Date;
    platform: NodeJS.Platform;
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  dependencies: WorktreeRemovalDependencies,
  target: string,
  cwd: string
): Promise<{ context: RepositoryContext; worktree: WorktreeInfo }> {
  const context = await dependencies.repository.requireContext(cwd);
  const worktrees = await dependencies.repository.loadWorktrees(context);

  if (target === ".") {
    const currentWorktree = findCurrentWorktree(worktrees, context.cwd);

    if (!currentWorktree) {
      throw new AppError("Current directory is not inside a git worktree");
    }

    return { context, worktree: currentWorktree };
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

  return { context, worktree: result.worktree };
}

async function findSafeRemovalRoot(
  dependencies: WorktreeRemovalDependencies,
  context: RepositoryContext,
  worktree: WorktreeInfo,
  knownPaths?: Array<{ path: string; isMain: boolean }>
): Promise<RemovalPlan["removalRoot"]> {
  if (!isPathInside(worktree.path, context.cwd)) {
    return { gitRoot: context.repoRoot };
  }

  const worktrees = knownPaths ?? await dependencies.repository.listPaths(context.repoRoot);
  const safeWorktree =
    worktrees.find(
      (candidate) => candidate.isMain && candidate.path !== worktree.path
    ) ?? worktrees.find((candidate) => candidate.path !== worktree.path);

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

function buildPlanRevision(input: {
  worktree: WorktreeInfo;
  isCurrent: boolean;
  status: WorktreeRemovalStatusSummary;
  statusEntries: string[];
  removalRoot: RemovalPlan["removalRoot"];
}): string {
  return JSON.stringify({
    id: input.worktree.id,
    fullId: input.worktree.fullId,
    path: input.worktree.path,
    branch: input.worktree.branch,
    head: input.worktree.head,
    isMain: input.worktree.isMain,
    baseBranch: input.worktree.baseBranch,
    baseCommit: input.worktree.baseCommit,
    isCurrent: input.isCurrent,
    localCommitCount: input.status.localCommitCount,
    localChangeCount: input.status.localChangeCount,
    hasUnknownLocalCommits: input.status.hasUnknownLocalCommits,
    statusEntries: input.statusEntries,
    removalRoot: input.removalRoot,
  });
}

function normalizeTaskPathSegment(value: string): string {
  return (
    value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "worktree"
  );
}

function buildRemovalTaskPaths(
  dependencies: WorktreeRemovalDependencies,
  safeWorktreePath: string,
  worktree: WorktreeInfo
): { statusFilePath: string; logFilePath: string } {
  const timestamp = dependencies.runtime
    .now()
    .toISOString()
    .replace(/[:.]/g, "-");
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
  options: ExecuteRemovalOptions
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

async function prepareRemovalPlugins(
  dependencies: WorktreeRemovalDependencies,
  plan: RemovalPlan
) {
  const settings = await dependencies.settings.load(plan.context.repoRoot);
  const plugins = await dependencies.plugins({
    repoRoot: plan.context.repoRoot,
    cwd: plan.removalRoot.gitRoot,
    settings,
  });
  return plugins.prepareRemoval({
    id: plan.worktree.id,
    path: plan.worktree.path,
    branch: plan.worktree.branch,
  });
}

const defaultDependencies: WorktreeRemovalDependencies = {
  repository: {
    requireContext: requireRepositoryContext,
    loadWorktrees: loadWorktreeInfos,
    listPaths: listGitWorktreePaths,
    inspectStatus: getWorktreeRemovalStatusSummary,
    createStatusReader: createWorktreeRemovalStatusReader,
  },
  settings: {
    load: loadSettings,
  },
  git: {
    ensureTaskArtifactsExcluded: async (repoRoot) => {
      await ensureRemoveTaskArtifactsExcluded(repoRoot);
    },
    remove: removeGitWorktree,
    deleteBranch,
  },
  tasks: {
    start: executeDetachedTask,
  },
  plugins: loadWorktreePlugins,
  runtime: {
    changeDirectory: (path) => process.chdir(path),
    now: () => new Date(),
    platform: process.platform,
  },
};

export function createWorktreeRemoval(
  dependencies: WorktreeRemovalDependencies
): {
  orderTargets: (targets: string[], cwd?: string) => Promise<string[]>;
  createPreviewInspector: (
    context: RepositoryContext,
    worktrees: WorktreeInfo[]
  ) => RemovalPreviewInspector;
  inspect: (
    target: string,
    cwd?: string,
    options?: InspectRemovalOptions
  ) => Promise<RemovalPlan>;
  execute: (
    plan: RemovalPlan,
    options: ExecuteRemovalOptions
  ) => Promise<RemovalResult>;
} {
  const orderTargets = async (targets: string[], cwd = process.cwd()) => {
    const context = await dependencies.repository.requireContext(cwd);
    const worktrees = await dependencies.repository.loadWorktrees(context);
    const current = findCurrentWorktree(worktrees, context.cwd);
    const resolved = targets.map((target) => {
      const worktree = target === "."
        ? current
        : resolveWorktreeTarget(worktrees, target, { allowPartialPath: true }).worktree;
      return {
        target: worktree?.path ?? target,
        resolved: worktree !== undefined,
        isCurrent: worktree !== undefined && worktree.path === current?.path,
      };
    });
    // Keep the invoking checkout's settings and plugins alive for the whole batch.
    // Report unresolved selectors before deletions can turn an ambiguous match into
    // a different target. Resolve "." now and execute each known worktree once.
    return [...new Set(resolved
      .sort((left, right) =>
        Number(left.resolved) - Number(right.resolved) ||
        Number(left.isCurrent) - Number(right.isCurrent)
      )
      .map(({ target }) => target))];
  };

  const inspectResolved = async (
    context: RepositoryContext,
    worktree: WorktreeInfo,
    options: InspectRemovalOptions,
    inspectStatus = dependencies.repository.inspectStatus,
    knownPaths?: Array<{ path: string; isMain: boolean }>
  ): Promise<RemovalPlan> => {
    const statusEntryLimit = options.statusEntryLimit ?? 8;
    const [status, removalRoot] = await Promise.all([
      inspectStatus(
        context.repoRoot,
        worktree.path,
        worktree.branch,
        worktree.baseBranch,
        { includeStatusEntries: options.includeStatusEntries, statusEntryLimit }
      ),
      findSafeRemovalRoot(dependencies, context, worktree, knownPaths),
    ]);
    const { statusEntries, ...summary } = status;
    const isCurrent = isPathInside(worktree.path, context.cwd);

    return {
      target: worktree.path,
      context,
      worktree,
      isCurrent,
      ...summary,
      ...(statusEntries
        ? {
            statusEntries: statusEntries.entries,
            remainingStatusEntryCount: Math.max(
              statusEntries.totalCount - statusEntries.entries.length,
              0
            ),
          }
        : {}),
      removalRoot,
      revision: buildPlanRevision({
        worktree,
        isCurrent,
        status,
        statusEntries: statusEntries?.entries ?? [],
        removalRoot,
      }),
    };
  };

  const inspect = async (
    target: string,
    cwd: string = process.cwd(),
    options: InspectRemovalOptions = {}
  ): Promise<RemovalPlan> => {
    const { context, worktree } = await resolveRemovalTarget(dependencies, target, cwd);
    return inspectResolved(context, worktree, options);
  };

  const createPreviewInspector = (
    context: RepositoryContext,
    worktrees: WorktreeInfo[]
  ): RemovalPreviewInspector => {
    const byPath = new Map(worktrees.map(worktree => [worktree.path, worktree]));
    const paths = worktrees.map(({ path, isMain }) => ({ path, isMain: isMain === true }));
    const readStatus = dependencies.repository.createStatusReader?.(
      context.repoRoot,
      worktrees.flatMap(worktree => worktree.branch && !worktree.isDetached ? [worktree.branch] : [])
    );
    const inspectStatus: WorktreeRemovalDependencies["repository"]["inspectStatus"] = readStatus
      ? (_repoRoot, path, branch, baseBranch, options) => readStatus(path, branch, baseBranch, options)
      : dependencies.repository.inspectStatus;

    return async (worktreePath, options = {}) => {
      const worktree = byPath.get(worktreePath);
      if (!worktree) throw new AppError(`Worktree path "${worktreePath}" is not in the cleanup plan`);
      return inspectResolved(context, worktree, options, inspectStatus, paths);
    };
  };

  const executeForeground = async (
    plan: RemovalPlan,
    options: ExecuteRemovalOptions
  ): Promise<RemovedWorktreeResult | BranchRemovalFailedResult> => {
    const afterRemoval = await prepareRemovalPlugins(dependencies, plan);

    if (plan.removalRoot.relocatedToPath) {
      dependencies.runtime.changeDirectory(plan.removalRoot.relocatedToPath);
    }

    await dependencies.git.remove(
      plan.removalRoot.gitRoot,
      plan.worktree.path
    );

    let branchError: string | undefined;
    let branchDeleted = false;

    if (!options.keepBranch && plan.worktree.branch) {
      try {
        await dependencies.git.deleteBranch(
          plan.removalRoot.gitRoot,
          plan.worktree.branch
        );
        branchDeleted = true;
      } catch (error) {
        branchError = getErrorMessage(error);
      }
    }

    const warnings = await afterRemoval(
      branchError
        ? { status: "worktree_removed_branch_failed", error: branchError }
        : { status: "removed", branchDeleted }
    );

    if (branchError) {
      return {
        status: "worktree_removed_branch_failed",
        worktree: plan.worktree,
        relocatedToPath: plan.removalRoot.relocatedToPath,
        error: branchError,
        warnings,
      };
    }

    return {
      status: "removed",
      worktree: plan.worktree,
      branchDeleted,
      relocatedToPath: plan.removalRoot.relocatedToPath,
      warnings,
    };
  };

  const executeBackground = async (
    plan: RemovalPlan,
    options: ExecuteRemovalOptions
  ): Promise<BackgroundRemovalResult> => {
    if (!plan.removalRoot.relocatedToPath) {
      throw new AppError(
        "Could not find another worktree to remove this worktree safely"
      );
    }

    const afterRemoval = await prepareRemovalPlugins(dependencies, plan);
    await dependencies.git.ensureTaskArtifactsExcluded(
      plan.removalRoot.relocatedToPath
    );
    const { statusFilePath, logFilePath } = buildRemovalTaskPaths(
      dependencies,
      plan.removalRoot.relocatedToPath,
      plan.worktree
    );
    dependencies.runtime.changeDirectory(plan.removalRoot.relocatedToPath);
    const pid = dependencies.tasks.start({
      scripts: buildRemovalTaskScripts(
        plan.removalRoot.gitRoot,
        plan.worktree,
        options
      ),
      cwd: plan.removalRoot.gitRoot,
      env: {
        WT_ID: plan.worktree.id,
        WT_PATH: plan.worktree.path,
        ...(plan.worktree.branch
          ? { WT_BRANCH: plan.worktree.branch }
          : {}),
      },
      statusFilePath,
      logFilePath,
      statusMetadata: {
        kind: "remove-worktree",
        worktreeId: plan.worktree.id,
        worktreePath: plan.worktree.path,
        branch: plan.worktree.branch,
      },
      startNotification:
        dependencies.runtime.platform === "darwin"
          ? buildRemovalStartNotification(plan.worktree)
          : undefined,
      completionNotification:
        dependencies.runtime.platform === "darwin"
          ? buildRemovalCompletionNotification(plan.worktree)
          : undefined,
    });
    const warnings = await afterRemoval({ status: "background_started", pid });

    return {
      status: "background_started",
      worktree: plan.worktree,
      branchDeleteQueued: Boolean(
        plan.worktree.branch && !options.keepBranch
      ),
      relocatedToPath: plan.removalRoot.relocatedToPath,
      pid,
      statusFilePath,
      logFilePath,
      warnings,
    };
  };

  const execute = async (
    plan: RemovalPlan,
    options: ExecuteRemovalOptions
  ): Promise<RemovalResult> => {
    let latestPlan: RemovalPlan;

    try {
      latestPlan = await inspect(plan.target, plan.context.cwd, {
        includeStatusEntries: plan.statusEntries !== undefined,
        statusEntryLimit: plan.statusEntries?.length,
      });
    } catch (error) {
      return {
        status: "plan_stale",
        reason: getErrorMessage(error),
      };
    }

    if (latestPlan.revision !== plan.revision) {
      return {
        status: "plan_stale",
        latestPlan,
        reason: "Worktree state changed after removal was approved",
      };
    }

    const shouldRunInBackground =
      options.execution === "auto" &&
      latestPlan.isCurrent &&
      !latestPlan.worktree.isMain;

    return shouldRunInBackground
      ? executeBackground(latestPlan, options)
      : executeForeground(latestPlan, options);
  };

  return { orderTargets, inspect, createPreviewInspector, execute };
}

const defaultRemoval = createWorktreeRemoval(defaultDependencies);

export const inspectRemoval = defaultRemoval.inspect;
export const executeRemoval = defaultRemoval.execute;
export const orderRemovalTargets = defaultRemoval.orderTargets;

export const createRemovalPreviewInspector = defaultRemoval.createPreviewInspector;
