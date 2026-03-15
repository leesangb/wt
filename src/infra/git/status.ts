import { $ } from "bun";

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
