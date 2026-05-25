import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { isAbsolute, join } from "path";
import {
  mergeSettingsInputs,
  normalizeSettings,
  type WtSettings,
  type WtSettingsInput,
} from "../../domain/settings.js";

export const LOCAL_SETTINGS_GITIGNORE_ENTRY = "settings.local.json";
export const REMOVE_TASK_GITIGNORE_ENTRIES = [
  "remove-task-*.json",
  "remove-task-*.log",
];
const LOCAL_SETTINGS_GITIGNORE_ALIASES = new Set([
  LOCAL_SETTINGS_GITIGNORE_ENTRY,
  "/settings.local.json",
]);

export async function getSettingsPath(repoRoot: string): Promise<string> {
  return join(repoRoot, ".wt", "settings.json");
}

export async function getLocalSettingsPath(repoRoot: string): Promise<string> {
  return join(repoRoot, ".wt", "settings.local.json");
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

export interface SettingsInputs {
  shared?: WtSettingsInput;
  local?: WtSettingsInput;
}

export async function loadSettingsInputs(
  repoRoot: string
): Promise<SettingsInputs> {
  const settingsPath = await getSettingsPath(repoRoot);
  const localSettingsPath = await getLocalSettingsPath(repoRoot);

  return {
    shared: await readSettingsInput(settingsPath),
    local: await readSettingsInput(localSettingsPath),
  };
}

export async function loadSettings(repoRoot: string): Promise<WtSettings> {
  const { shared, local } = await loadSettingsInputs(repoRoot);

  return normalizeSettings(mergeSettingsInputs(shared, local));
}

export async function ensureLocalSettingsIgnored(
  repoRoot: string
): Promise<boolean> {
  return ensureWtGitignoreEntries(repoRoot, [LOCAL_SETTINGS_GITIGNORE_ENTRY]);
}

export async function ensureRemoveTaskArtifactsIgnored(
  repoRoot: string
): Promise<boolean> {
  return ensureWtGitignoreEntries(repoRoot, REMOVE_TASK_GITIGNORE_ENTRIES);
}

async function ensureWtGitignoreEntries(
  repoRoot: string,
  entries: string[]
): Promise<boolean> {
  const settingsDir = join(repoRoot, ".wt");
  const gitignorePath = join(settingsDir, ".gitignore");

  if (!existsSync(settingsDir)) {
    mkdirSync(settingsDir, { recursive: true });
  }

  const currentContent = existsSync(gitignorePath)
    ? readFileSync(gitignorePath, "utf-8")
    : "";
  const currentLines = currentContent
    .split(/\r?\n/)
    .map((line) => line.trim());
  const missingEntries = entries.filter((entry) => {
    if (entry === LOCAL_SETTINGS_GITIGNORE_ENTRY) {
      return !currentLines.some((line) =>
        LOCAL_SETTINGS_GITIGNORE_ALIASES.has(line)
      );
    }

    return !currentLines.includes(entry);
  });

  if (missingEntries.length === 0) {
    return false;
  }

  const separator =
    currentContent.length === 0 || currentContent.endsWith("\n") ? "" : "\n";

  writeFileSync(
    gitignorePath,
    `${currentContent}${separator}${missingEntries.join("\n")}\n`,
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
