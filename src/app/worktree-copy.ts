import { $ } from "bun";
import { cpSync, mkdirSync, readdirSync } from "fs";
import { dirname, isAbsolute, join, relative } from "path";
import type { WtSettings } from "../domain/settings.js";

const DEFAULT_EXCLUDE_GLOBS = [
  ".git",
  ".git/**",
  "**/.git",
  "**/.git/**",
  "node_modules",
  "node_modules/**",
  "**/node_modules",
  "**/node_modules/**",
  ".wt/.gitignore",
  ".wt/meta.json",
  ".wt/post-task.json",
  ".wt/post-task.log",
];

const GLOB_MAGIC_PATTERN = /[*?[\]{}]/;

interface CompiledGlob {
  pattern: string;
  glob: Bun.Glob;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function compileGlobs(patterns: string[]): CompiledGlob[] {
  return dedupe(patterns).map((pattern) => ({
    pattern,
    glob: new Bun.Glob(pattern),
  }));
}

function matchesAny(globs: CompiledGlob[], relativePath: string): boolean {
  return globs.some(({ glob }) => glob.match(relativePath));
}

function getStaticPrefix(pattern: string): string {
  const normalizedPattern = pattern.replaceAll("\\", "/").replace(/^!+/, "");
  const segments = normalizedPattern.split("/");
  const prefixSegments: string[] = [];

  for (const segment of segments) {
    if (!segment || GLOB_MAGIC_PATTERN.test(segment)) {
      break;
    }

    prefixSegments.push(segment);
  }

  return prefixSegments.join("/");
}

function shouldTraverseDirectory(
  relativePath: string,
  includePrefixes: string[]
): boolean {
  if (!relativePath) {
    return true;
  }

  return includePrefixes.some((prefix) => {
    if (!prefix) {
      return true;
    }

    return (
      prefix === relativePath ||
      prefix.startsWith(`${relativePath}/`) ||
      relativePath.startsWith(`${prefix}/`)
    );
  });
}

async function getGitIgnoredDirectoryGlobs(repoRoot: string): Promise<string[]> {
  const output =
    await $`git -C ${repoRoot} ls-files --others -i --exclude-standard --directory -z`.text();

  return output
    .split("\0")
    .filter((entry) => entry.endsWith("/"))
    .flatMap((entry) => {
      const directoryPath = entry.slice(0, -1);

      return [directoryPath, `${directoryPath}/**`];
    });
}

async function getGitTrackedFilePaths(repoRoot: string): Promise<Set<string>> {
  try {
    const output = await $`git -C ${repoRoot} ls-files --cached -z`.text();

    return new Set(output.split("\0").filter(Boolean));
  } catch (error) {
    const stderr =
      typeof error === "object" && error && "stderr" in error
        ? String(error.stderr)
        : "";
    const exitCode =
      typeof error === "object" && error && "exitCode" in error
        ? Number(error.exitCode)
        : undefined;

    if (exitCode === 128 && stderr.includes("not a git repository")) {
      return new Set();
    }

    throw error;
  }
}

function resolveWorktreeRelativePath(
  repoRoot: string,
  worktreePath: string
): string | undefined {
  const relativePath = relative(repoRoot, worktreePath).replaceAll("\\", "/");

  if (
    !relativePath ||
    relativePath === "." ||
    relativePath.startsWith("../") ||
    relativePath === ".." ||
    isAbsolute(relativePath)
  ) {
    return undefined;
  }

  return relativePath;
}

export async function copyConfiguredPaths(
  settings: Pick<WtSettings, "copy">,
  repoRoot: string,
  worktreePath: string
): Promise<void> {
  if (settings.copy.include.length === 0) {
    return;
  }

  const includeGlobs = compileGlobs(settings.copy.include);
  const includePrefixes = dedupe(settings.copy.include.map(getStaticPrefix));
  const gitIgnoredDirectoryGlobs = await getGitIgnoredDirectoryGlobs(repoRoot);
  const sourceTrackedFilePaths = await getGitTrackedFilePaths(repoRoot);
  const targetTrackedFilePaths = await getGitTrackedFilePaths(worktreePath);
  const worktreeRelativePath = resolveWorktreeRelativePath(repoRoot, worktreePath);
  const excludeGlobs = compileGlobs([
    ...DEFAULT_EXCLUDE_GLOBS,
    ...gitIgnoredDirectoryGlobs,
    ...settings.copy.exclude,
  ]);

  function walk(relativeDirPath: string, inheritedIncluded: boolean): void {
    const sourceDirPath = relativeDirPath
      ? join(repoRoot, relativeDirPath)
      : repoRoot;

    for (const entry of readdirSync(sourceDirPath, { withFileTypes: true })) {
      const relativePath = relativeDirPath
        ? `${relativeDirPath}/${entry.name}`
        : entry.name;

      if (worktreeRelativePath && relativePath === worktreeRelativePath) {
        continue;
      }

      if (matchesAny(excludeGlobs, relativePath)) {
        continue;
      }

      const explicitlyIncluded = matchesAny(includeGlobs, relativePath);
      const included = inheritedIncluded || explicitlyIncluded;

      if (entry.isDirectory()) {
        if (!included && !shouldTraverseDirectory(relativePath, includePrefixes)) {
          continue;
        }

        walk(relativePath, included);
        continue;
      }

      if (
        !included ||
        sourceTrackedFilePaths.has(relativePath) ||
        targetTrackedFilePaths.has(relativePath)
      ) {
        continue;
      }

      const sourcePath = join(repoRoot, relativePath);
      const destinationPath = join(worktreePath, relativePath);

      mkdirSync(dirname(destinationPath), { recursive: true });
      cpSync(sourcePath, destinationPath, {
        dereference: false,
        force: true,
        recursive: false,
        verbatimSymlinks: true,
      });
    }
  }

  walk("", false);
}
