import { basename } from "path";
import { spawn } from "bun";
import { statSync } from "fs";
import type { WorktreeInfo } from "../types/index.js";
import { $ } from "bun";

export async function isGitRepository(): Promise<boolean> {
  try {
    await $`git rev-parse --git-dir`.quiet();
    return true;
  } catch {
    return false;
  }
}

export async function getGitRoot(): Promise<string> {
  const result = await $`git rev-parse --show-toplevel`.text();
  return result.trim();
}

export async function getRepoName(): Promise<string> {
  try {
    const remoteUrl = await $`git remote get-url origin`.text();
    const url = remoteUrl.trim();
    
    const match = url.match(/\/([^\/]+?)(?:\.git)?$/);
    if (match) {
      return match[1];
    }
  } catch {
  }
  
  const root = await getGitRoot();
  return basename(root);
}

export async function fetchRemote(): Promise<void> {
  await $`git fetch`;
}

export async function createWorktree(path: string, branch: string, base: string, pushRemote: boolean = true): Promise<void> {
  const addProc = spawn(['git', 'worktree', 'add', '-b', branch, path, base], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const addResult = await addProc.exited;
  if (addResult !== 0) {
    throw new Error(`git worktree add failed with exit code ${addResult}`);
  }

  if (pushRemote) {
    const pushProc = spawn(['git', '-C', path, 'push', '-u', 'origin', branch], {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const pushResult = await pushProc.exited;
    if (pushResult !== 0) {
      throw new Error(`git push failed with exit code ${pushResult}`);
    }
  }
}

export async function listWorktrees(): Promise<WorktreeInfo[]> {
  const result = await $`git worktree list --porcelain`.text();
  const worktrees: WorktreeInfo[] = [];
  
  const entries = result.trim().split('\n\n');
  const repoName = await getRepoName();
  
  for (const entry of entries) {
    const lines = entry.split('\n');
    let path = '';
    let branch = '';
    
    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.substring(9);
      } else if (line.startsWith('branch ')) {
        branch = line.substring(7).replace('refs/heads/', '');
      }
    }
    
    if (path && branch) {
      const fullId = basename(path);
      const id = fullId.startsWith(`${repoName}-`) 
        ? fullId.substring(repoName.length + 1) 
        : fullId;
      
      const stats = statSync(path);
      
      let baseBranch: string | undefined;
      let baseCommit: string | undefined;
      
      try {
        const { readFileSync } = await import("fs");
        const metaPath = `${path}/.wt-meta`;
        const metaContent = readFileSync(metaPath, 'utf-8');
        const meta = JSON.parse(metaContent);
        baseBranch = meta.baseBranch;
        baseCommit = meta.baseCommit;
      } catch {
      }
      
      worktrees.push({
        id,
        fullId,
        path,
        branch,
        repoName,
        createdAt: stats.birthtime.toISOString(),
        baseBranch,
        baseCommit,
      });
    }
  }
  
  return worktrees;
}

export async function removeWorktree(path: string): Promise<void> {
  await $`git worktree remove ${path} --force`;
}

export async function deleteBranch(branch: string): Promise<void> {
  await $`git branch -D ${branch}`;
}

export async function isBranchMergedToRemote(branch: string): Promise<boolean> {
  try {
    const result = await $`git branch -r --merged origin/main`.text();
    const mergedBranches = result.trim().split('\n').map(b => b.trim());
    return mergedBranches.some(b => b === `origin/${branch}`);
  } catch {
    return false;
  }
}

export async function getUnpushedCommitCount(path: string, branch: string): Promise<number> {
  try {
    const result = await $`git -C ${path} rev-list --count origin/${branch}..${branch}`.quiet().text();
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export async function getLocalModificationCount(path: string): Promise<number> {
  try {
    const result = await $`git -C ${path} status --porcelain`.text();
    const lines = result.trim().split('\n').filter(line => line.length > 0);
    return lines.length;
  } catch {
    return 0;
  }
}

export async function getCommitHash(ref: string): Promise<string> {
  try {
    const result = await $`git rev-parse ${ref}`.text();
    return result.trim();
  } catch {
    return '';
  }
}
