import {
  mergeSettingsInputs,
  normalizeSettings,
  type WtSettings,
  type WtSettingsInput,
} from "../domain/settings.js";
import { listGitWorktreePaths } from "../infra/git/worktree-repository.js";
import { loadSettingsInputs } from "../infra/storage/settings-store.js";

export interface RepositorySettings {
  settings: WtSettings;
  worktreeDirRoot: string;
}

interface SettingsInputSource {
  input?: WtSettingsInput;
  root: string;
}

async function resolveMainWorktreePath(
  repoRoot: string
): Promise<string | undefined> {
  const worktrees = await listGitWorktreePaths(repoRoot);
  return worktrees.find((worktree) => worktree.isMain)?.path;
}

function selectWorktreeDirRoot(
  sources: SettingsInputSource[],
  fallbackRoot: string
): string {
  return (
    sources.find((source) => source.input?.worktreeDir !== undefined)?.root ??
    fallbackRoot
  );
}

export async function loadRepositorySettings(
  repoRoot: string
): Promise<RepositorySettings> {
  const mainWorktreePath = await resolveMainWorktreePath(repoRoot);
  const settingsRoot = mainWorktreePath ?? repoRoot;
  const currentInputs = await loadSettingsInputs(repoRoot);
  const mainInputs =
    settingsRoot === repoRoot
      ? currentInputs
      : await loadSettingsInputs(settingsRoot);
  const sharedSource: SettingsInputSource = mainInputs.shared
    ? { input: mainInputs.shared, root: settingsRoot }
    : { input: currentInputs.shared, root: repoRoot };
  const mainLocalSource: SettingsInputSource | undefined =
    settingsRoot === repoRoot
      ? undefined
      : { input: mainInputs.local, root: settingsRoot };
  const currentLocalSource: SettingsInputSource = {
    input: currentInputs.local,
    root: repoRoot,
  };
  const localSettings = mergeSettingsInputs(
    mainLocalSource?.input,
    currentLocalSource.input
  );
  const settings = normalizeSettings(
    mergeSettingsInputs(sharedSource.input, localSettings)
  );
  const worktreeDirRoot = selectWorktreeDirRoot(
    [
      currentLocalSource,
      ...(mainLocalSource ? [mainLocalSource] : []),
      sharedSource,
    ],
    sharedSource.root
  );

  return { settings, worktreeDirRoot };
}
