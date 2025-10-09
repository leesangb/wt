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
  path: string;
  branch: string;
  createdAt: string;
}
