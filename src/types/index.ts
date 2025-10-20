export interface WtSettings {
  worktreeDir: string;
  baseBranch?: string;
  pushRemote?: boolean;
  scripts?: {
    pre?: string[];
    post?: string[];
  };
}

export interface WorktreeInfo {
  id: string;
  fullId: string;
  path: string;
  branch: string;
  repoName: string;
  createdAt: string;
  baseBranch?: string;
  baseCommit?: string;
}
