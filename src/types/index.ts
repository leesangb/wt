export interface WtSettings {
  worktreeDir: string;
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
