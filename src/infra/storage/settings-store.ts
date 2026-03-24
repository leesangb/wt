import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join } from "path";
import {
  mergeSettingsInputs,
  normalizeSettings,
  type WtSettings,
  type WtSettingsInput,
} from "../../domain/settings.js";

export const LOCAL_SETTINGS_GITIGNORE_ENTRY = ".wt/settings.local.json";
const LOCAL_SETTINGS_GITIGNORE_ALIASES = new Set([
  LOCAL_SETTINGS_GITIGNORE_ENTRY,
  "/.wt/settings.local.json",
]);

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

export async function loadSettings(repoRoot: string): Promise<WtSettings> {
  const settingsPath = await getSettingsPath(repoRoot);
  const localSettingsPath = join(repoRoot, ".wt", "settings.local.json");
  const sharedSettings = await readSettingsInput(settingsPath);
  const localSettings = await readSettingsInput(localSettingsPath);

  return normalizeSettings(mergeSettingsInputs(sharedSettings, localSettings));
}

export async function ensureLocalSettingsIgnored(
  repoRoot: string
): Promise<boolean> {
  const gitignorePath = join(repoRoot, ".gitignore");
  const currentContent = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";
  const alreadyIgnored = currentContent
    .split(/\r?\n/)
    .some((line) => LOCAL_SETTINGS_GITIGNORE_ALIASES.has(line.trim()));

  if (alreadyIgnored) {
    return false;
  }

  const separator =
    currentContent.length === 0 || currentContent.endsWith("\n") ? "" : "\n";

  writeFileSync(
    gitignorePath,
    `${currentContent}${separator}${LOCAL_SETTINGS_GITIGNORE_ENTRY}\n`,
    "utf-8"
  );

  return true;
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
