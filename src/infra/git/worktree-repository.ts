import { spawn } from "bun";
import { $ } from "bun";
import type { GitWorktreeRef } from "../../domain/worktree.js";

export async function fetchRemote(repoRoot: string): Promise<void> {
  await $`git -C ${repoRoot} fetch`;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export async function fetchRemoteBranch(
  repoRoot: string,
  branch: string,
  remote: string = "origin"
): Promise<boolean> {
  const fetchProc = spawn(
    [
      "git",
      "fetch",
      remote,
      `refs/heads/${branch}:refs/remotes/${remote}/${branch}`,
    ],
    {
      cwd: repoRoot,
      stdout: "ignore",
      stderr: "ignore",
    }
  );

  return (await fetchProc.exited) === 0;
}

export async function createGitWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
  baseBranch: string,
  pushRemote: boolean = true
): Promise<void> {
  const addProc = spawn(
    ["git", "worktree", "add", "-b", branch, worktreePath, baseBranch],
    {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  const addResult = await addProc.exited;

  if (addResult !== 0) {
    throw new Error(`git worktree add failed with exit code ${addResult}`);
  }

  if (!pushRemote) {
    return;
  }

  const pushProc = spawn(["git", "push", "-u", "origin", branch], {
    cwd: worktreePath,
    stdout: "inherit",
    stderr: "inherit",
  });
  const pushResult = await pushProc.exited;

  if (pushResult !== 0) {
    const cleanupErrors: string[] = [];

    try {
      await removeGitWorktree(repoRoot, worktreePath);
    } catch (error) {
      cleanupErrors.push(`remove worktree: ${getErrorMessage(error)}`);
    }

    try {
      await deleteBranch(repoRoot, branch);
    } catch (error) {
      cleanupErrors.push(`delete branch ${branch}: ${getErrorMessage(error)}`);
    }

    if (cleanupErrors.length > 0) {
      throw new Error(
        `git push failed with exit code ${pushResult}. Cleanup failed: ${cleanupErrors.join("; ")}`
      );
    }

    throw new Error(
      `git push failed with exit code ${pushResult}. Cleaned up the partially created worktree.`
    );
  }
}

async function localBranchExists(
  repoRoot: string,
  branch: string
): Promise<boolean> {
  const proc = spawn(
    ["git", "show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    {
      cwd: repoRoot,
      stdout: "ignore",
      stderr: "ignore",
    }
  );

  return (await proc.exited) === 0;
}

export { localBranchExists };

export async function createDetachedGitWorktree(
  repoRoot: string,
  worktreePath: string,
  ref: string
): Promise<void> {
  const addProc = spawn(
    ["git", "worktree", "add", "--detach", worktreePath, ref],
    {
      cwd: repoRoot,
      stdout: "inherit",
      stderr: "inherit",
    }
  );
  const addResult = await addProc.exited;

  if (addResult !== 0) {
    throw new Error(`git worktree add failed with exit code ${addResult}`);
  }
}

export async function attachGitWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  const addProc = spawn(["git", "worktree", "add", worktreePath, branch], {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const addResult = await addProc.exited;

  if (addResult !== 0) {
    throw new Error(`git worktree add failed with exit code ${addResult}`);
  }
}

export async function createOrAttachGitWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string,
  baseBranch: string
): Promise<void> {
  const addArgs = (await localBranchExists(repoRoot, branch))
    ? ["git", "worktree", "add", worktreePath, branch]
    : ["git", "worktree", "add", "-b", branch, worktreePath, baseBranch];
  const addProc = spawn(addArgs, {
    cwd: repoRoot,
    stdout: "inherit",
    stderr: "inherit",
  });
  const addResult = await addProc.exited;

  if (addResult !== 0) {
    throw new Error(`git worktree add failed with exit code ${addResult}`);
  }
}

export async function listGitWorktrees(
  repoRoot: string
): Promise<GitWorktreeRef[]> {
  const result = await $`git -C ${repoRoot} worktree list --porcelain`.text();

  if (!result.trim()) {
    return [];
  }

  const entries = result.trim().split("\n\n");

  return entries
    .map((entry, index): GitWorktreeRef | undefined => {
      const lines = entry.split("\n");
      let path = "";
      let branch: string | undefined;
      let head: string | undefined;
      let isDetached = false;
      let isPrunable = false;

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          path = line.substring(9);
        } else if (line.startsWith("branch ")) {
          branch = line.substring(7).replace("refs/heads/", "");
        } else if (line.startsWith("HEAD ")) {
          head = line.substring(5);
        } else if (line === "detached") {
          isDetached = true;
        } else if (line.startsWith("prunable")) {
          isPrunable = true;
        }
      }

      if (!path || isPrunable) {
        return undefined;
      }

      return {
        path,
        isMain: index === 0,
        isDetached,
        head,
        ...(branch ? { branch } : {}),
      };
    })
    .filter((entry): entry is GitWorktreeRef => Boolean(entry));
}

export async function listGitWorktreePaths(
  repoRoot: string
): Promise<Array<{ path: string; isMain: boolean }>> {
  const result = await $`git -C ${repoRoot} worktree list --porcelain`.text();

  if (!result.trim()) {
    return [];
  }

  const entries = result.trim().split("\n\n");

  return entries
    .map((entry, index): { path: string; isMain: boolean } | undefined => {
      const lines = entry.split("\n");
      const pathLine = lines.find((line) => line.startsWith("worktree "));
      const isPrunable = lines.some((line) => line.startsWith("prunable"));

      if (!pathLine || isPrunable) {
        return undefined;
      }

      return {
        path: pathLine.substring(9),
        isMain: index === 0,
      };
    })
    .filter((entry): entry is { path: string; isMain: boolean } => Boolean(entry));
}

export async function removeGitWorktree(
  repoRoot: string,
  worktreePath: string
): Promise<void> {
  await $`git -C ${repoRoot} worktree remove ${worktreePath} --force`;
}

export async function deleteBranch(
  repoRoot: string,
  branch: string
): Promise<void> {
  await $`git -C ${repoRoot} branch -D ${branch}`;
}
