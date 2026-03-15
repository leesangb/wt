export type ScriptMode = "sync" | "async";

export interface WtScriptsSettings {
  pre: string[];
  post: string[];
  postMode: ScriptMode;
}

export interface WtSettings {
  worktreeDir: string;
  baseBranch: string;
  pushRemote: boolean;
  scripts: WtScriptsSettings;
}

export type WtSettingsInput = Partial<Omit<WtSettings, "scripts">> & {
  scripts?: Partial<WtScriptsSettings>;
};

export const DEFAULT_WT_SETTINGS: WtSettings = {
  worktreeDir: "~/.wt",
  baseBranch: "main",
  pushRemote: true,
  scripts: {
    pre: [],
    post: [],
    postMode: "async",
  },
};

export function normalizeSettings(
  input?: WtSettingsInput | null
): WtSettings {
  return {
    worktreeDir: input?.worktreeDir ?? DEFAULT_WT_SETTINGS.worktreeDir,
    baseBranch: input?.baseBranch ?? DEFAULT_WT_SETTINGS.baseBranch,
    pushRemote: input?.pushRemote ?? DEFAULT_WT_SETTINGS.pushRemote,
    scripts: {
      pre: input?.scripts?.pre ?? DEFAULT_WT_SETTINGS.scripts.pre,
      post: input?.scripts?.post ?? DEFAULT_WT_SETTINGS.scripts.post,
      postMode:
        input?.scripts?.postMode ?? DEFAULT_WT_SETTINGS.scripts.postMode,
    },
  };
}
