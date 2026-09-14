import { existsSync, mkdirSync, writeFileSync } from "fs";
import { isAbsolute, join } from "path";
import {
  mergeSettingsInputs,
  normalizeSettings,
  type WtSettings,
  type WtSettingsInput,
} from "../../domain/settings.js";

export async function getSettingsPath(repoRoot: string): Promise<string> {
  return join(repoRoot, ".wt", "settings.json");
}

export async function settingsExist(repoRoot: string): Promise<boolean> {
  const settingsPath = await getSettingsPath(repoRoot);
  return existsSync(settingsPath);
}

async function readSettingsInput(
  settingsPath: string
): Promise<WtSettingsInput | undefined> {
  if (!existsSync(settingsPath)) {
    return undefined;
  }

  return JSON.parse(await Bun.file(settingsPath).text()) as WtSettingsInput;
}

export async function loadSettingsInput(repoRoot: string) {
  const settingsPath = await getSettingsPath(repoRoot);
  const localSettingsPath = join(repoRoot, ".wt", "settings.local.json");
  const sharedSettings = await readSettingsInput(settingsPath);
  const localSettings = await readSettingsInput(localSettingsPath);

  return mergeSettingsInputs(sharedSettings, localSettings);
}

export async function loadSettings(repoRoot: string): Promise<WtSettings> {
  return normalizeSettings(await loadSettingsInput(repoRoot));
}

export async function saveSettings(
  repoRoot: string,
  settings: WtSettings
): Promise<void> {
  const settingsPath = await getSettingsPath(repoRoot);
  const settingsDir = join(repoRoot, ".wt");

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }

  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(process.env.HOME || "", path.slice(2));
  }

  return path;
}

export function resolveWorktreeDir(
  worktreeDir: string,
  repoRoot: string
): string {
  const expandedPath = expandPath(worktreeDir);

  if (isAbsolute(expandedPath)) {
    return expandedPath;
  }

  return join(repoRoot, expandedPath);
}
