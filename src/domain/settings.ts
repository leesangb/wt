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

export interface WtIssueSettings {
  pattern: string;
  url: string;
}

export interface WtHerdrSettings {
  closeWorkspaceOnRemove: boolean;
}

export interface WtSettings {
  worktreeDir: string;
  baseBranch: string;
  pushRemote: boolean;
  copy: WtCopySettings;
  scripts: WtScriptsSettings;
  herdr: WtHerdrSettings;
  issue?: WtIssueSettings;
}

export type WtCopySettingsInput = string[] | Partial<WtCopySettings>;

export type WtSettingsInput = Partial<
  Omit<WtSettings, "copy" | "scripts" | "herdr" | "issue">
> & {
  copy?: WtCopySettingsInput;
  scripts?: Partial<WtScriptsSettings>;
  herdr?: Partial<WtHerdrSettings>;
  issue?: Partial<WtIssueSettings>;
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
  herdr: {
    closeWorkspaceOnRemove: true,
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

function normalizeIssueInput(
  input?: Partial<WtIssueSettings> | null
): WtIssueSettings | undefined {
  if (!input?.pattern || !input.url) {
    return undefined;
  }

  return {
    pattern: input.pattern,
    url: input.url,
  };
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
  const mergedIssue =
    base?.issue || override?.issue
      ? {
          ...base?.issue,
          ...override?.issue,
        }
      : undefined;
  const mergedHerdr =
    base?.herdr || override?.herdr
      ? {
          ...base?.herdr,
          ...override?.herdr,
        }
      : undefined;

  return {
    ...base,
    ...override,
    ...(mergedCopy ? { copy: mergedCopy } : {}),
    ...(mergedScripts ? { scripts: mergedScripts } : {}),
    ...(mergedHerdr ? { herdr: mergedHerdr } : {}),
    ...(mergedIssue ? { issue: mergedIssue } : {}),
  };
}

export function normalizeSettings(
  input?: WtSettingsInput | null
): WtSettings {
  const copyInput = normalizeCopyInput(input?.copy);
  const issueInput = normalizeIssueInput(input?.issue);

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
    herdr: {
      closeWorkspaceOnRemove:
        input?.herdr?.closeWorkspaceOnRemove ??
        DEFAULT_WT_SETTINGS.herdr.closeWorkspaceOnRemove,
    },
    ...(issueInput ? { issue: issueInput } : {}),
  };
}
