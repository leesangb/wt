import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import { $ } from "bun";

export const LOCAL_SETTINGS_EXCLUDE_ENTRY = ".wt/settings.local.json";
export const REMOVE_TASK_EXCLUDE_ENTRIES = [
  ".wt/remove-task-*.json",
  ".wt/remove-task-*.log",
];

const WT_LOCAL_EXCLUDE_ENTRIES = [
  LOCAL_SETTINGS_EXCLUDE_ENTRY,
  ...REMOVE_TASK_EXCLUDE_ENTRIES,
];

async function getGitExcludePath(repoRoot: string): Promise<string> {
  const output =
    await $`git -C ${repoRoot} rev-parse --git-path info/exclude`.text();
  const path = output.trim();

  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

async function ensureGitExcludeEntries(
  repoRoot: string,
  entries: readonly string[]
): Promise<boolean> {
  const excludePath = await getGitExcludePath(repoRoot);
  const currentContent = existsSync(excludePath)
    ? readFileSync(excludePath, "utf-8")
    : "";
  const currentLines = currentContent
    .split(/\r?\n/)
    .map((line) => line.trim());
  const missingEntries = entries.filter(
    (entry) =>
      !currentLines.includes(entry) && !currentLines.includes(`/${entry}`)
  );

  if (missingEntries.length === 0) {
    return false;
  }

  mkdirSync(dirname(excludePath), { recursive: true });
  const separator =
    currentContent.length === 0 || currentContent.endsWith("\n") ? "" : "\n";

  writeFileSync(
    excludePath,
    `${currentContent}${separator}${missingEntries.join("\n")}\n`,
    "utf-8"
  );

  return true;
}

export async function ensureWtLocalFilesExcluded(
  repoRoot: string
): Promise<boolean> {
  return ensureGitExcludeEntries(repoRoot, WT_LOCAL_EXCLUDE_ENTRIES);
}

export async function ensureRemoveTaskArtifactsExcluded(
  repoRoot: string
): Promise<boolean> {
  return ensureGitExcludeEntries(repoRoot, REMOVE_TASK_EXCLUDE_ENTRIES);
}
