export type ScriptMode = "sync" | "async";

export interface WtScriptsSettings {
  pre: string[];
  post: string[];
  postMode: ScriptMode;
}

export interface WtCopySettings {
  include: string[];
  exclude: string[];
}

export interface WtSettings {
  worktreeDir: string;
  baseBranch: string;
  pushRemote: boolean;
  copy: WtCopySettings;
  scripts: WtScriptsSettings;
}

export type WtCopySettingsInput = string[] | Partial<WtCopySettings>;

export type WtSettingsInput = Partial<Omit<WtSettings, "copy" | "scripts">> & {
  copy?: WtCopySettingsInput;
  scripts?: Partial<WtScriptsSettings>;
};

export const DEFAULT_WT_SETTINGS: WtSettings = {
  worktreeDir: "~/.wt",
  baseBranch: "main",
  pushRemote: true,
  copy: {
    include: [],
    exclude: [],
  },
  scripts: {
    pre: [],
    post: [],
    postMode: "async",
  },
};

function normalizeCopyInput(
  input?: WtCopySettingsInput | null
): Partial<WtCopySettings> | undefined {
  if (!input) {
    return undefined;
  }

  if (Array.isArray(input)) {
    return {
      include: input,
    };
  }

  return input;
}

export function mergeSettingsInputs(
  base?: WtSettingsInput | null,
  override?: WtSettingsInput | null
): WtSettingsInput | undefined {
  if (!base && !override) {
    return undefined;
  }

  const mergedScripts =
    base?.scripts || override?.scripts
      ? {
          ...base?.scripts,
          ...override?.scripts,
        }
      : undefined;
  const baseCopy = normalizeCopyInput(base?.copy);
  const overrideCopy = normalizeCopyInput(override?.copy);
  const mergedCopy =
    baseCopy || overrideCopy
      ? {
          ...baseCopy,
          ...overrideCopy,
        }
      : undefined;

  return {
    ...base,
    ...override,
    ...(mergedCopy ? { copy: mergedCopy } : {}),
    ...(mergedScripts ? { scripts: mergedScripts } : {}),
  };
}

export function normalizeSettings(
  input?: WtSettingsInput | null
): WtSettings {
  const copyInput = normalizeCopyInput(input?.copy);

  return {
    worktreeDir: input?.worktreeDir ?? DEFAULT_WT_SETTINGS.worktreeDir,
    baseBranch: input?.baseBranch ?? DEFAULT_WT_SETTINGS.baseBranch,
    pushRemote: input?.pushRemote ?? DEFAULT_WT_SETTINGS.pushRemote,
    copy: {
      include: copyInput?.include ?? DEFAULT_WT_SETTINGS.copy.include,
      exclude: copyInput?.exclude ?? DEFAULT_WT_SETTINGS.copy.exclude,
    },
    scripts: {
      pre: input?.scripts?.pre ?? DEFAULT_WT_SETTINGS.scripts.pre,
      post: input?.scripts?.post ?? DEFAULT_WT_SETTINGS.scripts.post,
      postMode:
        input?.scripts?.postMode ?? DEFAULT_WT_SETTINGS.scripts.postMode,
    },
  };
}
