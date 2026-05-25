import type { WtSettings } from "../domain/settings.js";
import { listGitWorktreePaths } from "../infra/git/worktree-repository.js";
import {
  loadSettings,
  settingsExist,
} from "../infra/storage/settings-store.js";

export interface RepositorySettings {
  settings: WtSettings;
  settingsRoot: string;
}

async function resolveMainWorktreePath(
  repoRoot: string
): Promise<string | undefined> {
  const worktrees = await listGitWorktreePaths(repoRoot);
  return worktrees.find((worktree) => worktree.isMain)?.path;
}

export async function loadRepositorySettings(
  repoRoot: string
): Promise<RepositorySettings> {
  if (await settingsExist(repoRoot)) {
    return {
      settings: await loadSettings(repoRoot),
      settingsRoot: repoRoot,
    };
  }

  const mainWorktreePath = await resolveMainWorktreePath(repoRoot);

  if (
    mainWorktreePath &&
    mainWorktreePath !== repoRoot &&
    (await settingsExist(mainWorktreePath))
  ) {
    return {
      settings: await loadSettings(mainWorktreePath),
      settingsRoot: mainWorktreePath,
    };
  }

  return {
    settings: await loadSettings(repoRoot),
    settingsRoot: repoRoot,
  };
}
