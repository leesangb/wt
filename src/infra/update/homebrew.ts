import { realpathSync } from "fs";
import { spawnSync } from "node:child_process";
import { AppError } from "../../app/errors.js";

const HOMEBREW_PREFIXES = [
  "/opt/homebrew",
  "/usr/local",
  "/home/linuxbrew/.linuxbrew",
];

export interface HomebrewProcessInfo {
  argv0?: string;
  execPath?: string;
  resolvePath?: (path: string) => string | undefined;
}

export interface HomebrewUpdatePlan {
  args: string[];
  displayCommand: string;
}

export interface HomebrewUpdateOptions {
  force?: boolean;
  version?: string;
  removeQuarantine?: boolean;
}

export interface BrewCommandResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
}

export type BrewCommandRunner = (
  command: string,
  args: string[],
  options: {
    stdio: "inherit";
  }
) => BrewCommandResult;

function normalizeExecutablePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function defaultResolvePath(path: string): string | undefined {
  try {
    return normalizeExecutablePath(realpathSync(path));
  } catch {
    return undefined;
  }
}

function looksLikePath(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  return value.includes("/") || value.includes("\\");
}

function isHomebrewManagedTargetPath(normalizedPath: string): boolean {
  return HOMEBREW_PREFIXES.some((prefix) => {
    return (
      normalizedPath.startsWith(`${prefix}/Cellar/wt/`) ||
      normalizedPath.startsWith(`${prefix}/opt/wt/`)
    );
  });
}

function isHomebrewLinkedBinPath(normalizedPath: string): boolean {
  return HOMEBREW_PREFIXES.some(
    (prefix) => normalizedPath === `${prefix}/bin/wt`
  );
}

function isHomebrewExecutablePath(
  path: string,
  resolvePath: (path: string) => string | undefined = defaultResolvePath
): boolean {
  const normalizedPath = normalizeExecutablePath(path);

  if (isHomebrewManagedTargetPath(normalizedPath)) {
    return true;
  }

  if (!isHomebrewLinkedBinPath(normalizedPath)) {
    return false;
  }

  const resolvedPath = resolvePath(path);

  return Boolean(resolvedPath && isHomebrewManagedTargetPath(resolvedPath));
}

export function isHomebrewManagedInstallation(
  processInfo: HomebrewProcessInfo = {
    argv0: process.argv0,
    execPath: process.execPath,
  }
): boolean {
  const resolvePath = processInfo.resolvePath ?? defaultResolvePath;
  const candidates = [
    processInfo.execPath,
    looksLikePath(processInfo.argv0) ? processInfo.argv0 : undefined,
  ].filter((value): value is string => Boolean(value));

  return candidates.some((candidate) =>
    isHomebrewExecutablePath(candidate, resolvePath)
  );
}

export function buildHomebrewUpdatePlan(
  options: HomebrewUpdateOptions,
  formulaName: string = "wt"
): HomebrewUpdatePlan {
  if (options.version) {
    throw new AppError(
      "Homebrew-managed installs do not support `wt update --version`. Use Homebrew to install a specific formula revision instead."
    );
  }

  if (options.removeQuarantine === false) {
    throw new AppError(
      "`--no-remove-quarantine` is only supported for standalone binary installs."
    );
  }

  if (options.force) {
    return {
      args: ["reinstall", formulaName],
      displayCommand: `brew reinstall ${formulaName}`,
    };
  }

  return {
    args: ["upgrade", formulaName],
    displayCommand: `brew upgrade ${formulaName}`,
  };
}

export function runHomebrewUpdate(
  plan: HomebrewUpdatePlan,
  runCommand: BrewCommandRunner = (command, args, options) =>
    spawnSync(command, args, options)
): void {
  const result = runCommand("brew", plan.args, {
    stdio: "inherit",
  });

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;

    if (error.code === "ENOENT") {
      throw new AppError(
        "Homebrew installation detected, but `brew` was not found in PATH."
      );
    }

    throw new AppError(
      `Failed to run ${plan.displayCommand}: ${result.error.message}`
    );
  }

  if (result.status !== 0) {
    throw new AppError(
      `${plan.displayCommand} failed. Try running \`brew update && ${plan.displayCommand}\` manually.`
    );
  }
}
