import { spawn } from "bun";
import { $ } from "bun";
import type { GitWorktreeRef } from "../../domain/worktree.js";

export async function fetchRemote(repoRoot: string): Promise<void> {
  await $`git -C ${repoRoot} fetch`;
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
    throw new Error(`git push failed with exit code ${pushResult}`);
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
    .map((entry, index) => {
      const lines = entry.split("\n");
      let path = "";
      let branch = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          path = line.substring(9);
        } else if (line.startsWith("branch ")) {
          branch = line.substring(7).replace("refs/heads/", "");
        }
      }

      if (!path || !branch) {
        return undefined;
      }

      return {
        path,
        branch,
        isMain: index === 0,
      };
    })
    .filter((entry): entry is GitWorktreeRef => Boolean(entry));
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
