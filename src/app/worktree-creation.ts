import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { WtSettings } from "../domain/settings.js";
import {
  buildWorktreeIdentifiers,
  buildWorktreePathCollisionSuffix,
  buildWorktreePathName,
  createWorktreeMeta,
  type WorktreeMeta,
} from "../domain/worktree.js";
import {
  attachGitWorktree,
  createDetachedGitWorktree,
  createGitWorktree,
  deleteBranch,
  fetchRemote,
  fetchRemoteBranch,
  localBranchExists,
  removeGitWorktree,
} from "../infra/git/worktree-repository.js";
import {
  getCommitHash,
  getMergeBase,
  isRefAncestor,
  resolveCommitHash,
} from "../infra/git/status.js";
import {
  checkoutPullRequest,
  type PullRequestInfo,
} from "../infra/github/cli.js";
import {
  executeScripts,
  executeScriptsDetached,
} from "../infra/scripts/runner.js";
import {
  loadSettings,
  resolveWorktreeDir,
} from "../infra/storage/settings-store.js";
import {
  readWorktreeMeta,
  writeWorktreeMeta,
} from "../infra/storage/worktree-meta-store.js";
import { AppError } from "./errors.js";
import type { RepositoryContext } from "./repository-context.js";
import { copyConfiguredPaths } from "./worktree-copy.js";

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

interface NewWorktreeCreation {
  kind: "new";
  context: RepositoryContext;
  branchName: string;
  options: {
    base?: string;
    push?: boolean;
    id?: string;
  };
}

interface ExistingBranchWorktreeCreation {
  kind: "existing-branch";
  context: RepositoryContext;
  branchName: string;
  existingIds: string[];
}

interface PullRequestWorktreeCreation {
  kind: "pull-request";
  context: RepositoryContext;
  pullRequest: PullRequestInfo;
  existingIds: string[];
}

export type WorktreeCreationRequest =
  | NewWorktreeCreation
  | ExistingBranchWorktreeCreation
  | PullRequestWorktreeCreation;

type PostCreationResult = Pick<
  CreateWorktreeResult,
  "postMode" | "postTask"
>;

export interface WorktreeCreationDependencies {
  settings: {
    load: (repoRoot: string) => Promise<WtSettings>;
    resolveWorktreeDir: (path: string, repoRoot: string) => string;
  };
  files: {
    exists: (path: string) => boolean;
    ensureDirectory: (path: string) => void;
  };
  metadata: {
    read: (worktreePath: string) => Promise<WorktreeMeta | undefined>;
    write: (worktreePath: string, meta: WorktreeMeta) => Promise<void>;
  };
  git: {
    fetchRemote: (repoRoot: string) => Promise<void>;
    fetchRemoteBranch: (repoRoot: string, branch: string) => Promise<boolean>;
    getCommitHash: (repoRoot: string, ref: string) => Promise<string>;
    getMergeBase: (
      repoRoot: string,
      firstRef: string,
      secondRef: string
    ) => Promise<string>;
    resolveCommitHash: (
      repoRoot: string,
      refs: string[]
    ) => Promise<{ commitHash: string; resolvedRef: string } | undefined>;
    isRefAncestor: (
      repoRoot: string,
      ancestorRef: string,
      descendantRef: string
    ) => Promise<boolean>;
    localBranchExists: (repoRoot: string, branch: string) => Promise<boolean>;
    createNew: (
      repoRoot: string,
      worktreePath: string,
      branch: string,
      baseBranch: string,
      pushRemote: boolean
    ) => Promise<void>;
    attachExisting: (
      repoRoot: string,
      worktreePath: string,
      branch: string
    ) => Promise<void>;
    createDetached: (
      repoRoot: string,
      worktreePath: string,
      ref: string
    ) => Promise<void>;
    checkoutPullRequest: (
      worktreePath: string,
      pullRequestNumber: string
    ) => Promise<void>;
    remove: (repoRoot: string, worktreePath: string) => Promise<void>;
    deleteBranch: (repoRoot: string, branch: string) => Promise<void>;
  };
  scripts: {
    runPre: (
      settings: WtSettings,
      repoRoot: string,
      environment: Record<string, string>
    ) => Promise<void>;
    runPost: (
      settings: WtSettings,
      worktreePath: string,
      environment: Record<string, string>
    ) => Promise<PostCreationResult>;
  };
  copy: (
    settings: Pick<WtSettings, "copy">,
    repoRoot: string,
    worktreePath: string
  ) => Promise<void>;
}

interface PreparedCreation {
  branchName: string;
  id: string;
  fullId: string;
  worktreePath: string;
  baseBranch: string;
  baseCommit: string;
  idAdjustedFrom?: string;
  metadata?: Pick<WorktreeMeta, "prNumber" | "prUrl">;
  materialize: () => Promise<void>;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

function resolveUniqueWorktreeId(
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

function resolveFreshWorktreePath(
  dependencies: WorktreeCreationDependencies,
  worktreeBaseDir: string,
  repoName: string,
  id: string
): string {
  const basePath = join(worktreeBaseDir, buildWorktreePathName(repoName, id));

  if (!dependencies.files.exists(basePath)) {
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

    if (!dependencies.files.exists(candidatePath)) {
      return candidatePath;
    }

    attempt += 1;
  }
}

async function canReuseWorktreePath(
  dependencies: WorktreeCreationDependencies,
  repoName: string,
  worktreePath: string,
  id: string
): Promise<boolean> {
  if (!dependencies.files.exists(worktreePath)) {
    return true;
  }

  const meta = await dependencies.metadata.read(worktreePath);
  return meta
    ? buildWorktreeIdentifiers(repoName, worktreePath, meta).id === id
    : false;
}

async function resolveReusableWorktreePath(
  dependencies: WorktreeCreationDependencies,
  worktreeBaseDir: string,
  repoName: string,
  id: string
): Promise<string> {
  const basePath = join(worktreeBaseDir, buildWorktreePathName(repoName, id));

  if (await canReuseWorktreePath(dependencies, repoName, basePath, id)) {
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

    if (
      await canReuseWorktreePath(
        dependencies,
        repoName,
        candidatePath,
        id
      )
    ) {
      return candidatePath;
    }

    attempt += 1;
  }
}

async function resolvePullRequestBaseCommit(
  dependencies: WorktreeCreationDependencies,
  repoRoot: string,
  baseBranch: string
): Promise<string> {
  const initialResolution = await dependencies.git.resolveCommitHash(repoRoot, [
    baseBranch,
    `origin/${baseBranch}`,
    `refs/remotes/origin/${baseBranch}`,
  ]);

  if (initialResolution) {
    return initialResolution.commitHash;
  }

  await dependencies.git.fetchRemoteBranch(repoRoot, baseBranch);
  const fetchedResolution = await dependencies.git.resolveCommitHash(repoRoot, [
    `origin/${baseBranch}`,
    `refs/remotes/origin/${baseBranch}`,
    baseBranch,
  ]);

  if (fetchedResolution) {
    return fetchedResolution.commitHash;
  }

  throw new AppError(
    `Could not resolve PR base branch ${baseBranch} from origin. Fetch it manually or confirm the branch still exists.`
  );
}

async function prepareNewCreation(
  dependencies: WorktreeCreationDependencies,
  request: NewWorktreeCreation,
  settings: WtSettings,
  worktreeBaseDir: string
): Promise<PreparedCreation> {
  const { context, branchName, options } = request;
  const baseBranch = options.base ?? settings.baseBranch;
  const pushRemote = options.push ?? settings.pushRemote;
  const id = options.id ?? branchName;
  const fullId = `${context.repoName}-${id}`;
  const worktreePath = await resolveReusableWorktreePath(
    dependencies,
    worktreeBaseDir,
    context.repoName,
    id
  );

  await dependencies.git.fetchRemote(context.repoRoot);
  const baseCommit = await dependencies.git.getCommitHash(
    context.repoRoot,
    baseBranch
  );

  return {
    branchName,
    id,
    fullId,
    worktreePath,
    baseBranch,
    baseCommit,
    materialize: () =>
      dependencies.git.createNew(
        context.repoRoot,
        worktreePath,
        branchName,
        baseBranch,
        pushRemote
      ),
  };
}

async function prepareExistingBranchCreation(
  dependencies: WorktreeCreationDependencies,
  request: ExistingBranchWorktreeCreation,
  settings: WtSettings,
  worktreeBaseDir: string
): Promise<PreparedCreation> {
  const { context, branchName } = request;
  const { id, idAdjustedFrom } = resolveUniqueWorktreeId(
    branchName,
    request.existingIds
  );
  const fullId = `${context.repoName}-${id}`;
  const worktreePath = resolveFreshWorktreePath(
    dependencies,
    worktreeBaseDir,
    context.repoName,
    id
  );
  const baseBranch = settings.baseBranch;
  const baseCommit =
    (await dependencies.git.getMergeBase(
      context.repoRoot,
      branchName,
      baseBranch
    )) ||
    (await dependencies.git.getCommitHash(context.repoRoot, baseBranch));

  return {
    branchName,
    id,
    fullId,
    worktreePath,
    baseBranch,
    baseCommit,
    idAdjustedFrom,
    materialize: () =>
      dependencies.git.attachExisting(
        context.repoRoot,
        worktreePath,
        branchName
      ),
  };
}

async function preparePullRequestCreation(
  dependencies: WorktreeCreationDependencies,
  request: PullRequestWorktreeCreation,
  worktreeBaseDir: string
): Promise<PreparedCreation> {
  const { context, pullRequest } = request;
  const branchName = pullRequest.headRefName;
  const preferredId = `pr-${pullRequest.number}`;
  const { id, idAdjustedFrom } = resolveUniqueWorktreeId(
    preferredId,
    request.existingIds
  );
  const fullId = `${context.repoName}-${id}`;

  await dependencies.git.fetchRemote(context.repoRoot);

  const baseBranch = pullRequest.baseRefName;
  const baseCommit = await resolvePullRequestBaseCommit(
    dependencies,
    context.repoRoot,
    baseBranch
  );
  const branchExistedBeforeCheckout =
    await dependencies.git.localBranchExists(context.repoRoot, branchName);

  if (
    branchExistedBeforeCheckout &&
    !(await dependencies.git.isRefAncestor(
      context.repoRoot,
      branchName,
      pullRequest.headRefOid
    ))
  ) {
    throw new AppError(
      `Local branch ${branchName} already exists but diverges from PR #${pullRequest.number}. Refusing to reset it automatically; delete or rename the local branch, or merge/rebase it manually first.`
    );
  }

  const worktreePath = resolveFreshWorktreePath(
    dependencies,
    worktreeBaseDir,
    context.repoName,
    id
  );

  return {
    branchName,
    id,
    fullId,
    worktreePath,
    baseBranch,
    baseCommit,
    idAdjustedFrom,
    metadata: {
      prNumber: pullRequest.number,
      prUrl: pullRequest.url,
    },
    materialize: async () => {
      await dependencies.git.createDetached(
        context.repoRoot,
        worktreePath,
        baseCommit
      );

      try {
        await dependencies.git.checkoutPullRequest(
          worktreePath,
          pullRequest.number
        );
      } catch (error) {
        const cleanupErrors: string[] = [];

        try {
          await dependencies.git.remove(context.repoRoot, worktreePath);
        } catch (cleanupError) {
          cleanupErrors.push(
            `remove worktree: ${getErrorMessage(cleanupError)}`
          );
        }

        if (!branchExistedBeforeCheckout) {
          try {
            if (
              await dependencies.git.localBranchExists(
                context.repoRoot,
                branchName
              )
            ) {
              await dependencies.git.deleteBranch(
                context.repoRoot,
                branchName
              );
            }
          } catch (cleanupError) {
            cleanupErrors.push(
              `delete branch ${branchName}: ${getErrorMessage(cleanupError)}`
            );
          }
        }

        if (cleanupErrors.length > 0) {
          throw new AppError(
            `${getErrorMessage(error)}\nCleanup failed for temporary PR worktree ${worktreePath}: ${cleanupErrors.join("; ")}`
          );
        }

        throw error;
      }
    },
  };
}

async function runPreCreationScripts(
  settings: WtSettings,
  repoRoot: string,
  environment: Record<string, string>
): Promise<void> {
  if (settings.scripts.pre.length > 0) {
    await executeScripts(settings.scripts.pre, repoRoot, environment);
  }
}

async function runPostCreationScripts(
  settings: WtSettings,
  worktreePath: string,
  environment: Record<string, string>
): Promise<PostCreationResult> {
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
      environment,
      statusFilePath,
      logFilePath
    );

    return {
      postMode: "async",
      postTask: { pid, statusFilePath, logFilePath },
    };
  }

  await executeScripts(settings.scripts.post, worktreePath, environment);
  return { postMode: "sync" };
}

const defaultDependencies: WorktreeCreationDependencies = {
  settings: {
    load: loadSettings,
    resolveWorktreeDir,
  },
  files: {
    exists: existsSync,
    ensureDirectory: (path) => {
      if (!existsSync(path)) {
        mkdirSync(path, { recursive: true });
      }
    },
  },
  metadata: {
    read: readWorktreeMeta,
    write: writeWorktreeMeta,
  },
  git: {
    fetchRemote,
    fetchRemoteBranch,
    getCommitHash,
    getMergeBase,
    resolveCommitHash,
    isRefAncestor,
    localBranchExists,
    createNew: createGitWorktree,
    attachExisting: attachGitWorktree,
    createDetached: createDetachedGitWorktree,
    checkoutPullRequest,
    remove: removeGitWorktree,
    deleteBranch,
  },
  scripts: {
    runPre: runPreCreationScripts,
    runPost: runPostCreationScripts,
  },
  copy: copyConfiguredPaths,
};

export function createWorktreeCreator(
  dependencies: WorktreeCreationDependencies
): (request: WorktreeCreationRequest) => Promise<CreateWorktreeResult> {
  return async (request) => {
    const { context } = request;
    const settings = await dependencies.settings.load(context.repoRoot);
    const worktreeBaseDir = dependencies.settings.resolveWorktreeDir(
      settings.worktreeDir,
      context.repoRoot
    );
    dependencies.files.ensureDirectory(worktreeBaseDir);

    const prepared =
      request.kind === "new"
        ? await prepareNewCreation(
            dependencies,
            request,
            settings,
            worktreeBaseDir
          )
        : request.kind === "existing-branch"
          ? await prepareExistingBranchCreation(
              dependencies,
              request,
              settings,
              worktreeBaseDir
            )
          : await preparePullRequestCreation(
              dependencies,
              request,
              worktreeBaseDir
            );
    const environment = createScriptEnvironment(
      context.repoRoot,
      prepared.worktreePath,
      prepared.id,
      prepared.fullId,
      prepared.branchName
    );

    await dependencies.scripts.runPre(
      settings,
      context.repoRoot,
      environment
    );
    await prepared.materialize();
    await dependencies.copy(
      settings,
      context.repoRoot,
      prepared.worktreePath
    );
    await dependencies.metadata.write(
      prepared.worktreePath,
      createWorktreeMeta(prepared.baseBranch, prepared.baseCommit, undefined, {
        id: prepared.id,
        fullId: prepared.fullId,
        ...prepared.metadata,
      })
    );
    const postResult = await dependencies.scripts.runPost(
      settings,
      prepared.worktreePath,
      environment
    );

    return {
      branchName: prepared.branchName,
      id: prepared.id,
      fullId: prepared.fullId,
      worktreePath: prepared.worktreePath,
      baseBranch: prepared.baseBranch,
      baseCommit: prepared.baseCommit,
      ...(prepared.idAdjustedFrom
        ? { idAdjustedFrom: prepared.idAdjustedFrom }
        : {}),
      ...postResult,
    };
  };
}

export const createPreparedWorktree =
  createWorktreeCreator(defaultDependencies);
