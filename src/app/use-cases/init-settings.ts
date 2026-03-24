import { DEFAULT_WT_SETTINGS } from "../../domain/settings.js";
import { requireRepositoryContext } from "../repository-context.js";
import {
  ensureLocalSettingsIgnored,
  getSettingsPath,
  saveSettings,
  settingsExist,
} from "../../infra/storage/settings-store.js";

export interface InitSettingsResult {
  created: boolean;
  gitignoreUpdated: boolean;
  settingsPath: string;
}

export async function initSettings(
  cwd: string = process.cwd()
): Promise<InitSettingsResult> {
  const context = await requireRepositoryContext(cwd);
  const existing = await settingsExist(context.repoRoot);
  const settingsPath = await getSettingsPath(context.repoRoot);

  if (existing) {
    const gitignoreUpdated = await ensureLocalSettingsIgnored(context.repoRoot);

    return {
      created: false,
      gitignoreUpdated,
      settingsPath,
    };
  }

  await saveSettings(context.repoRoot, DEFAULT_WT_SETTINGS);
  const gitignoreUpdated = await ensureLocalSettingsIgnored(context.repoRoot);

  return {
    created: true,
    gitignoreUpdated,
    settingsPath,
  };
}
