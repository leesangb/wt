import { $ } from "bun";

export interface WorktreeRemovalStatusSummary {
  localCommitCount: number;
  localChangeCount: number;
  hasUnknownLocalCommits: boolean;
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

export async function getMergedRemoteBranches(
  repoRoot: string,
  baseBranch?: string
): Promise<Set<string>> {
  try {
    const mergeBaseBranch =
      baseBranch ?? (await getDefaultRemoteBranch(repoRoot));

    if (!mergeBaseBranch) {
      return new Set();
    }

    const result =
      await $`git -C ${repoRoot} branch -r --merged origin/${mergeBaseBranch}`
        .text();

    return new Set(
      result
        .trim()
        .split("\n")
        .map((branch) => branch.trim())
        .filter((branch) => branch.length > 0)
    );
  } catch {
    return new Set();
  }
}

export async function isBranchMergedToRemote(
  repoRoot: string,
  branch: string,
  baseBranch?: string
): Promise<boolean> {
  const mergedBranches = await getMergedRemoteBranches(repoRoot, baseBranch);
  return mergedBranches.has(`origin/${branch}`);
}

export async function getWorktreeStatusSummary(
  worktreePath: string,
  branch: string
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
  branch: string,
  baseBranch?: string
): Promise<WorktreeRemovalStatusSummary> {
  const localChangeCount = await countStatusEntries(worktreePath);
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
  branch: string
): Promise<number> {
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
    const result = await $`git -C ${repoRoot} rev-parse ${ref}`.text();
    return result.trim();
  } catch {
    return "";
  }
}
