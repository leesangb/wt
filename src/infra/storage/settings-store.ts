import { existsSync, mkdirSync, writeFileSync } from "fs";
import { isAbsolute, join } from "path";
import {
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

export async function loadSettings(repoRoot: string): Promise<WtSettings> {
  const settingsPath = await getSettingsPath(repoRoot);

  if (!existsSync(settingsPath)) {
    return normalizeSettings();
  }

  const content = JSON.parse(await Bun.file(settingsPath).text());
  return normalizeSettings(content as WtSettingsInput);
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
