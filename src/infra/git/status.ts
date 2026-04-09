import { $ } from "bun";

export interface WorktreeRemovalStatusSummary {
  localCommitCount: number;
  localChangeCount: number;
  hasUnknownLocalCommits: boolean;
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
  repoRoot: string
): Promise<GoneUpstreamBranchesResult> {
  try {
    const format = "%(refname:short)\t%(upstream:track)";
    const result =
      await $`git -C ${repoRoot} for-each-ref --format=${format} refs/heads`
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
  const mergeBaseBranch = baseBranch ?? (await getDefaultRemoteBranch(repoRoot));

  if (!mergeBaseBranch) {
    throw new Error("Cannot determine merge status: no base branch specified and no default remote branch found");
  }

  const baseRef = `origin/${mergeBaseBranch}`;
  const baseExists = await getCommitHash(repoRoot, baseRef);

  if (!baseExists) {
    throw new Error(`Cannot determine merge status: ${baseRef} does not exist`);
  }

  return isRefAncestor(repoRoot, branch, baseRef);
}

export async function getWorktreeStatusSummary(
  worktreePath: string,
  branch?: string
): Promise<{
  unpushedCount: number;
  modifiedCount: number;
}> {
  try {
    const [unpushedCount, status] = await Promise.all([
      getUnpushedCommitCount(worktreePath, branch),
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
    const status = await $`git -C ${worktreePath} status --short`.text();
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

async function countStatusEntries(worktreePath: string): Promise<number> {
  try {
    const status = await $`git -C ${worktreePath} status --porcelain`.text();

    return status
      .trim()
      .split("\n")
      .filter((line) => line.length > 0).length;
  } catch {
    return 0;
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
  baseBranch?: string
): Promise<WorktreeRemovalStatusSummary> {
  const localChangeCount = await countStatusEntries(worktreePath);

  if (!branch) {
    return {
      localCommitCount: 0,
      localChangeCount,
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
      localChangeCount,
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
          localChangeCount,
          hasUnknownLocalCommits: false,
        };
      }
    }
  }

  return {
    localCommitCount: 0,
    localChangeCount,
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
