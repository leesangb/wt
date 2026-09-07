import { DEFAULT_WT_SETTINGS } from "../../domain/settings.js";
import { requireRepositoryContext } from "../repository-context.js";
import {
  getSettingsPath,
  saveSettings,
  settingsExist,
} from "../../infra/storage/settings-store.js";
import { ensureWtLocalFilesExcluded } from "../../infra/git/exclude.js";

export interface InitSettingsResult {
  created: boolean;
  localExcludeUpdated: boolean;
  settingsPath: string;
}

export async function initSettings(
  cwd: string = process.cwd()
): Promise<InitSettingsResult> {
  const context = await requireRepositoryContext(cwd);
  const existing = await settingsExist(context.repoRoot);
  const settingsPath = await getSettingsPath(context.repoRoot);

  if (existing) {
    const localExcludeUpdated = await ensureWtLocalFilesExcluded(
      context.repoRoot
    );

    return {
      created: false,
      localExcludeUpdated,
      settingsPath,
    };
  }

  await saveSettings(context.repoRoot, DEFAULT_WT_SETTINGS);
  const localExcludeUpdated = await ensureWtLocalFilesExcluded(
    context.repoRoot
  );

  return {
    created: true,
    localExcludeUpdated,
    settingsPath,
  };
}
