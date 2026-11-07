import { $ } from "bun";

export interface WorktreeRemovalStatusSummary {
  localCommitCount: number;
  localChangeCount: number;
  hasUnknownLocalCommits: boolean;
  statusEntries?: WorktreeStatusEntriesResult;
}

export interface WorktreeRemovalStatusOptions {
  includeStatusEntries?: boolean;
  statusEntryLimit?: number;
}

export interface WorktreeStatusEntriesResult {
  entries: string[];
  totalCount: number;
}

export interface MergedRemoteBranchesResult {
  branches: Set<string>;
  known: boolean;
}

export interface GoneUpstreamBranchesResult {
  branches: Set<string>;
  known: boolean;
}

export async function getDefaultRemoteBranch(
  repoRoot: string
): Promise<string | undefined> {
  try {
    const result =
      await $`git -C ${repoRoot} symbolic-ref refs/remotes/origin/HEAD`.text();
    return result.trim().replace("refs/remotes/origin/", "");
  } catch {
    return undefined;
  }
}

export async function getMergedRemoteBranchesResult(
  repoRoot: string,
  baseBranch?: string
): Promise<MergedRemoteBranchesResult> {
  try {
    const mergeBaseBranch =
      baseBranch ?? (await getDefaultRemoteBranch(repoRoot));

    if (!mergeBaseBranch) {
      return {
        branches: new Set(),
        known: false,
      };
    }

    const result =
      await $`git -C ${repoRoot} branch -r --merged origin/${mergeBaseBranch}`
        .text();

    return {
      branches: new Set(
        result
          .trim()
          .split("\n")
          .map((branch) => branch.trim())
          .filter((branch) => branch.length > 0)
      ),
      known: true,
    };
  } catch {
    return {
      branches: new Set(),
      known: false,
    };
  }
}

export async function getMergedRemoteBranches(
  repoRoot: string,
  baseBranch?: string
): Promise<Set<string>> {
  return (await getMergedRemoteBranchesResult(repoRoot, baseBranch)).branches;
}

export async function getGoneUpstreamBranchesResult(
  repoRoot: string,
  activeBranches?: readonly string[]
): Promise<GoneUpstreamBranchesResult> {
  try {
    const refs = activeBranches?.map(branch => `refs/heads/${branch}`) ?? ["refs/heads"];
    if (refs.length === 0) {
      return { branches: new Set<string>(), known: true };
    }
    const format = "%(refname:short)\t%(upstream:track)";
    const result =
      await $`git -C ${repoRoot} for-each-ref --format=${format} ${refs}`
        .text();
    const branches = new Set<string>();

    for (const line of result.split("\n")) {
      if (!line) {
        continue;
      }

      const separatorIndex = line.indexOf("\t");
      const branch =
        separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
      const upstreamTrack =
        separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";

      if (branch && upstreamTrack.includes("[gone]")) {
        branches.add(branch.trim());
      }
    }

    return {
      branches,
      known: true,
    };
  } catch {
    return {
      branches: new Set(),
      known: false,
    };
  }
}

export async function getGoneUpstreamBranches(
  repoRoot: string
): Promise<Set<string>> {
  return (await getGoneUpstreamBranchesResult(repoRoot)).branches;
}

export async function isBranchMergedToRemote(
  repoRoot: string,
  branch: string,
  baseBranch?: string
): Promise<boolean> {
  return createBranchMergeChecker(repoRoot, [branch])(branch, baseBranch);
}

// Share ref discovery only within one catalog operation, never across commands.
export function createBranchMergeChecker(
  repoRoot: string,
  activeBranches?: readonly string[]
) {
  const headRefs = activeBranches?.map((branch) => `refs/heads/${branch}`) ??
    ["refs/heads"];
  const collisionRefs = activeBranches?.flatMap((branch) => [
    `refs/tags/${branch}`,
    `refs/${branch}`,
  ]) ?? ["refs/tags", "refs"];
  const format = "%(refname)";
  let defaultBranch: Promise<string | undefined> | undefined;
  const baseCommits = new Map<string, Promise<string>>();
  const mergedBranches = new Map<string, Promise<Set<string>>>();
  let collisions: Promise<Set<string>> | undefined;

  return async (branch: string, baseBranch?: string): Promise<boolean> => {
    const mergeBaseBranch = baseBranch ??
      await (defaultBranch ??= getDefaultRemoteBranch(repoRoot));

    if (!mergeBaseBranch) {
      throw new Error("Cannot determine merge status: no base branch specified and no default remote branch found");
    }

    const baseRef = `origin/${mergeBaseBranch}`;
    let baseCommit = baseCommits.get(baseRef);
    if (!baseCommit) {
      baseCommit = getCommitHash(repoRoot, baseRef);
      baseCommits.set(baseRef, baseCommit);
    }
    if (!(await baseCommit)) {
      throw new Error(`Cannot determine merge status: ${baseRef} does not exist`);
    }
    let branches = mergedBranches.get(baseRef);
    if (!branches) {
      branches = (async () => {
        if (headRefs.length === 0) return new Set<string>();
        const result = await $`git -C ${repoRoot} for-each-ref --format=${format} --merged=${baseRef} ${headRefs}`.text();
        return new Set(result.trim().split("\n").filter(Boolean));
      })();
      mergedBranches.set(baseRef, branches);
    }
    collisions ??= (async () => {
      if (collisionRefs.length === 0) return new Set<string>();
      const result = await $`git -C ${repoRoot} for-each-ref --format=${format} ${collisionRefs}`.text();
      return new Set(result.trim().split("\n").filter(Boolean));
    })();
    try {
      const [merged, shadowingRefs] = await Promise.all([branches, collisions]);
      // Short refs can resolve before refs/heads; preserve Git's resolution.
      return shadowingRefs.has(`refs/tags/${branch}`) ||
        shadowingRefs.has(`refs/${branch}`) ||
        branch.startsWith("refs/") ||
        /^[A-Z_]+$/.test(branch)
        ? isRefAncestor(repoRoot, branch, baseRef)
        : merged.has(`refs/heads/${branch}`);
    } catch {
      // Keep the existing per-branch behavior when a batched ref query fails.
      return isRefAncestor(repoRoot, branch, baseRef);
    }
  };
}

type WorktreeRefSnapshot = Map<string, { upstream: string; objectname: string }>;

async function readWorktreeRefSnapshot(
  repoRoot: string,
  activeBranches: readonly string[]
): Promise<WorktreeRefSnapshot> {
  const refPatterns = [...new Set(activeBranches)].flatMap((branch) => [
    `refs/heads/${branch}`,
    `refs/remotes/origin/${branch}`,
    `refs/tags/${branch}`,
    `refs/${branch}`,
    `refs/heads/origin/${branch}`,
    `refs/tags/origin/${branch}`,
    `refs/origin/${branch}`,
  ]);
  try {
    if (refPatterns.length === 0) return new Map();
    const format = "%(refname)\t%(upstream)\t%(objectname)";
    const output = await $`git -C ${repoRoot} for-each-ref --format=${format} ${refPatterns}`.quiet().text();
    return new Map(output.trim().split("\n").filter(Boolean).map((line) => {
      const [ref, upstream, objectname] = line.split("\t");
      return [ref, { upstream: upstream ?? "", objectname: objectname ?? "" }];
    }));
  } catch {
    return new Map();
  }
}

function findUnambiguousOriginRefs(snapshot: WorktreeRefSnapshot, branch?: string) {
  if (!branch || branch.startsWith("refs/") || /^[A-Z_]+$/.test(branch) ||
    snapshot.has(`refs/tags/${branch}`) ||
    snapshot.has(`refs/${branch}`) ||
    snapshot.has(`refs/heads/origin/${branch}`) ||
    snapshot.has(`refs/tags/origin/${branch}`) ||
    snapshot.has(`refs/origin/${branch}`)) {
    return undefined;
  }
  const local = snapshot.get(`refs/heads/${branch}`);
  const origin = snapshot.get(`refs/remotes/origin/${branch}`);
  return local && origin ? { local, origin } : undefined;
}

// Scope the snapshot and its lifetime to the current catalog operation.
export function createWorktreeStatusReader(
  repoRoot: string,
  activeBranches: readonly string[]
) {
  const refs = readWorktreeRefSnapshot(repoRoot, activeBranches);
  return async (worktreePath: string, branch?: string) => {
    const originRefs = findUnambiguousOriginRefs(await refs, branch);
    const equalRefs = originRefs !== undefined && originRefs.local.objectname !== "" &&
      originRefs.local.objectname === originRefs.origin.objectname;
    const upstreamIsOriginBranch = originRefs !== undefined &&
      originRefs.local.upstream === `refs/remotes/origin/${branch}`;
    return readWorktreeStatusSummary(worktreePath, branch, {
      upstreamIsOriginBranch: !equalRefs && upstreamIsOriginBranch,
      knownUnpushedCount: equalRefs ? 0 : undefined,
    });
  };
}

export async function getWorktreeStatusSummary(
  worktreePath: string,
  branch?: string
): Promise<{ unpushedCount: number; modifiedCount: number }> {
  return readWorktreeStatusSummary(worktreePath, branch);
}

async function readWorktreeStatusSummary(
  worktreePath: string,
  branch: string | undefined,
  { upstreamIsOriginBranch = false, knownUnpushedCount }: {
    upstreamIsOriginBranch?: boolean;
    knownUnpushedCount?: number;
  } = {}
) {
  try {
    if (upstreamIsOriginBranch && branch) {
      const status = await $`git -C ${worktreePath} status --porcelain=v2 --branch`.text();
      const lines = status.trim().split("\n").filter(Boolean);
      const isSameBranch = lines.includes(`# branch.head ${branch}`);
      const ahead = lines
        .find((line) => line.startsWith("# branch.ab +"))
        ?.match(/^# branch\.ab \+(\d+) -\d+$/)?.[1];
      return {
        unpushedCount: isSameBranch && ahead !== undefined
          ? Number(ahead)
          : await getUnpushedCommitCount(worktreePath, branch),
        modifiedCount: lines.filter((line) => !line.startsWith("# ")).length,
      };
    }
    const [unpushedCount, status] = await Promise.all([
      knownUnpushedCount ?? getUnpushedCommitCount(worktreePath, branch),
      $`git -C ${worktreePath} status --porcelain`.text(),
    ]);

    return {
      unpushedCount,
      modifiedCount: status
        .trim()
        .split("\n")
        .filter((line) => line.length > 0).length,
    };
  } catch {
    if (upstreamIsOriginBranch) {
      // If the combined query is unavailable, retain the original status path.
      return readWorktreeStatusSummary(worktreePath, branch);
    }
    return {
      unpushedCount: 0,
      modifiedCount: 0,
    };
  }
}

export async function getWorktreeStatusEntries(
  worktreePath: string,
  limit: number = 8
): Promise<WorktreeStatusEntriesResult> {
  try {
    const status = await $`git -C ${worktreePath} status --porcelain`.text();
    const entries = status
      .trim()
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    return {
      entries: entries.slice(0, limit),
      totalCount: entries.length,
    };
  } catch {
    return {
      entries: [],
      totalCount: 0,
    };
  }
}

async function refExists(worktreePath: string, ref: string): Promise<boolean> {
  try {
    await $`git -C ${worktreePath} rev-parse --verify ${ref}`.quiet();
    return true;
  } catch {
    return false;
  }
}

async function getRevisionRangeCount(
  worktreePath: string,
  baseRef: string,
  branch: string
): Promise<number | undefined> {
  try {
    const result =
      await $`git -C ${worktreePath} rev-list --count ${baseRef}..${branch}`
        .quiet()
        .text();

    return parseInt(result.trim(), 10) || 0;
  } catch {
    return undefined;
  }
}

export async function getWorktreeRemovalStatusSummary(
  repoRoot: string,
  worktreePath: string,
  branch?: string,
  baseBranch?: string,
  options: WorktreeRemovalStatusOptions = {}
): Promise<WorktreeRemovalStatusSummary> {
  return readWorktreeRemovalStatusSummary(repoRoot, worktreePath, branch, baseBranch, options);
}

// Preview ref facts live only for one picker; execution uses the uncached reader.
export function createWorktreeRemovalStatusReader(
  repoRoot: string,
  activeBranches: readonly string[]
) {
  let refs: Promise<WorktreeRefSnapshot> | undefined;
  return (
    worktreePath: string,
    branch?: string,
    baseBranch?: string,
    options: WorktreeRemovalStatusOptions = {}
  ) => readWorktreeRemovalStatusSummary(
    repoRoot,
    worktreePath,
    branch,
    baseBranch,
    options,
    refs ??= readWorktreeRefSnapshot(repoRoot, activeBranches)
  );
}

async function readWorktreeRemovalStatusSummary(
  repoRoot: string,
  worktreePath: string,
  branch: string | undefined,
  baseBranch: string | undefined,
  options: WorktreeRemovalStatusOptions,
  refs?: Promise<WorktreeRefSnapshot>
): Promise<WorktreeRemovalStatusSummary> {
  const statusEntries = await getWorktreeStatusEntries(
    worktreePath,
    options.includeStatusEntries ? options.statusEntryLimit ?? 8 : 0
  );
  // Keep execution's commit check after the file scan; only previews share refs.
  const commits = await readRemovalCommitSummary(repoRoot, worktreePath, branch, baseBranch, refs);
  return {
    ...commits,
    localChangeCount: statusEntries.totalCount,
    ...(options.includeStatusEntries ? { statusEntries } : {}),
  };
}

async function readRemovalCommitSummary(
  repoRoot: string,
  worktreePath: string,
  branch: string | undefined,
  baseBranch: string | undefined,
  refs?: Promise<WorktreeRefSnapshot>
) {
  if (refs) {
    const originRefs = findUnambiguousOriginRefs(await refs, branch);
    if (originRefs && originRefs.local.objectname !== "" &&
      originRefs.local.objectname === originRefs.origin.objectname) {
      return { localCommitCount: 0, hasUnknownLocalCommits: false };
    }
  }
  if (!branch) {
    return {
      localCommitCount: 0,
      hasUnknownLocalCommits: true,
    };
  }

  const branchRemoteRef = `refs/remotes/origin/${branch}`;

  if (await refExists(worktreePath, branchRemoteRef)) {
    const localCommitCount = await getRevisionRangeCount(
      worktreePath,
      branchRemoteRef,
      branch
    );

    return {
      localCommitCount: localCommitCount ?? 0,
      hasUnknownLocalCommits: localCommitCount === undefined,
    };
  }

  const fallbackBaseBranches = [
    ...new Set(
      [baseBranch, await getDefaultRemoteBranch(repoRoot)].filter(
        (value): value is string => Boolean(value) && value !== branch
      )
    ),
  ];

  for (const fallbackBaseBranch of fallbackBaseBranches) {
    const fallbackRefs = [
      `refs/remotes/origin/${fallbackBaseBranch}`,
      `refs/heads/${fallbackBaseBranch}`,
    ];

    for (const fallbackRef of fallbackRefs) {
      if (!(await refExists(worktreePath, fallbackRef))) {
        continue;
      }

      const localCommitCount = await getRevisionRangeCount(
        worktreePath,
        fallbackRef,
        branch
      );

      if (localCommitCount !== undefined) {
        return {
          localCommitCount,
          hasUnknownLocalCommits: false,
        };
      }
    }
  }

  return {
    localCommitCount: 0,
    hasUnknownLocalCommits: true,
  };
}

export async function getUnpushedCommitCount(
  worktreePath: string,
  branch?: string
): Promise<number> {
  if (!branch) {
    return 0;
  }

  try {
    const result =
      await $`git -C ${worktreePath} rev-list --count origin/${branch}..${branch}`
        .quiet()
        .text();

    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export async function getCommitHash(
  repoRoot: string,
  ref: string
): Promise<string> {
  try {
    const result = await $`git -C ${repoRoot} rev-parse --verify ${ref}^{commit}`.text();
    return result.trim();
  } catch {
    return "";
  }
}

export async function resolveCommitHash(
  repoRoot: string,
  refs: string[]
): Promise<{ commitHash: string; resolvedRef: string } | undefined> {
  for (const ref of refs) {
    const commitHash = await getCommitHash(repoRoot, ref);

    if (commitHash) {
      return {
        commitHash,
        resolvedRef: ref,
      };
    }
  }

  return undefined;
}

export async function getMergeBase(
  repoRoot: string,
  firstRef: string,
  secondRef: string
): Promise<string> {
  try {
    const result = await $`git -C ${repoRoot} merge-base ${firstRef} ${secondRef}`.text();
    return result.trim();
  } catch {
    return "";
  }
}

export async function isRefAncestor(
  repoRoot: string,
  ancestorRef: string,
  descendantRef: string
): Promise<boolean> {
  try {
    await $`git -C ${repoRoot} merge-base --is-ancestor ${ancestorRef} ${descendantRef}`.quiet();
    return true;
  } catch {
    return false;
  }
}
