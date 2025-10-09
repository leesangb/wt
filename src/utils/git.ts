import { execa } from "execa";
import { basename } from "path";
import type { WorktreeInfo } from "../types/index.js";

export async function isGitRepository(): Promise<boolean> {
  try {
    await execa("git", ["rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

export async function getGitRoot(): Promise<string> {
  const result = await execa("git", ["rev-parse", "--show-toplevel"]);
  return result.stdout.trim();
}

export async function getRepoName(): Promise<string> {
  const root = await getGitRoot();
  return basename(root);
}

export async function createWorktree(path: string, branch: string, base: string, pushRemote: boolean = true): Promise<void> {
  await execa("git", ["worktree", "add", "-b", branch, path, base]);

  if (pushRemote) {
    await execa("git", ["push", "-u", "origin", branch], { cwd: path });
  }
}

export async function listWorktrees(): Promise<WorktreeInfo[]> {
  const result = await execa("git", ["worktree", "list", "--porcelain"]);
  const worktrees: WorktreeInfo[] = [];
  
  const entries = result.stdout.trim().split('\n\n');
  
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
      const pathParts = path.split('/');
      const id = pathParts[pathParts.length - 1];
      
      worktrees.push({
        id,
        path,
        branch,
        createdAt: new Date().toISOString(),
      });
    }
  }
  
  return worktrees;
}

export async function removeWorktree(path: string): Promise<void> {
  await execa("git", ["worktree", "remove", path, "--force"]);
}
