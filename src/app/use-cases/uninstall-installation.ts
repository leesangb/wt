import { existsSync, rmSync } from "fs";
import { homedir } from "os";
import { basename, join, resolve } from "path";
import { spawnSync } from "child_process";
import { AppError } from "../errors.js";
import { removeShellIntegration, type RemoveShellIntegrationResult } from "../../infra/shell/uninstaller.js";
import {
  buildHomebrewUninstallPlan,
  isHomebrewManagedInstallation,
  runHomebrewUninstall,
  type BrewCommandResult,
  type HomebrewProcessInfo,
  type HomebrewUninstallPlan,
} from "../../infra/update/homebrew.js";

const BINARY_NAME = "wt";
const RUNTIME_LAUNCHERS = new Set(["bun", "node"]);

export interface UninstallProcessInfo extends HomebrewProcessInfo {
  argv0?: string;
}

export interface StandaloneUninstallResult {
  strategy: "standalone";
  binaryPath: string;
  shellIntegration: RemoveShellIntegrationResult;
}

export interface HomebrewDelegatedUninstallResult {
  strategy: "homebrew";
  delegatedCommand: string;
  shellIntegration: RemoveShellIntegrationResult;
}

export type UninstallInstallationResult =
  | StandaloneUninstallResult
  | HomebrewDelegatedUninstallResult;

export interface UninstallInstallationContext {
  processInfo?: UninstallProcessInfo;
  isHomebrewInstallAvailable?: () => boolean;
  onBeforeHomebrewUninstall?: (command: string) => void;
  removeBinary?: (binaryPath: string) => void;
  removeShellIntegration?: () => RemoveShellIntegrationResult;
  runHomebrewUninstall?: (
    plan: HomebrewUninstallPlan
  ) => BrewCommandResult | void;
  standaloneBinaryPath?: string;
}

function defaultHomebrewInstallAvailable(): boolean {
  try {
    const result = spawnSync("brew", ["list", "--formula", BINARY_NAME], {
      stdio: "ignore",
    });

    return result.status === 0;
  } catch {
    return false;
  }
}

export function resolveCurrentStandaloneBinaryPath(
  processInfo: UninstallProcessInfo = {
    argv0: process.argv0,
    execPath: process.execPath,
  }
): string | undefined {
  if (!processInfo.execPath) {
    return undefined;
  }

  if (isHomebrewManagedInstallation(processInfo)) {
    return undefined;
  }

  const execPath = resolve(processInfo.execPath);
  if (basename(execPath).toLowerCase() === BINARY_NAME) {
    return execPath;
  }

  const argv0 = processInfo.argv0 ?? "";
  const launcherName = basename(argv0).toLowerCase();
  const hasExplicitPath = argv0.includes("/") || argv0.includes("\\");

  if (
    hasExplicitPath &&
    !RUNTIME_LAUNCHERS.has(launcherName) &&
    basename(argv0).toLowerCase() === BINARY_NAME
  ) {
    return resolve(argv0);
  }

  return undefined;
}

function removeStandaloneBinary(binaryPath: string): void {
  try {
    rmSync(binaryPath);
  } catch (error) {
    throw new AppError(`Failed to remove binary at ${binaryPath}: ${error}`);
  }
}

export function uninstallInstallation(
  context: UninstallInstallationContext = {}
): UninstallInstallationResult {
  const isCurrentHomebrewManaged = isHomebrewManagedInstallation(
    context.processInfo
  );
  const currentStandaloneBinaryPath = resolveCurrentStandaloneBinaryPath(
    context.processInfo
  );
  const discoveredStandaloneBinaryPath = context.standaloneBinaryPath
    ? resolve(context.standaloneBinaryPath)
    : join(homedir(), ".local", "bin", BINARY_NAME);
  const standaloneBinaryPath = currentStandaloneBinaryPath
    ? currentStandaloneBinaryPath
    : existsSync(discoveredStandaloneBinaryPath)
    ? discoveredStandaloneBinaryPath
    : undefined;
  const removeShell = context.removeShellIntegration ?? removeShellIntegration;

  if (isCurrentHomebrewManaged) {
    const plan = buildHomebrewUninstallPlan();

    context.onBeforeHomebrewUninstall?.(plan.displayCommand);
    (context.runHomebrewUninstall ?? runHomebrewUninstall)(plan);

    return {
      strategy: "homebrew",
      delegatedCommand: plan.displayCommand,
      shellIntegration: removeShell(),
    };
  }

  if (standaloneBinaryPath) {
    (context.removeBinary ?? removeStandaloneBinary)(standaloneBinaryPath);

    return {
      strategy: "standalone",
      binaryPath: standaloneBinaryPath,
      shellIntegration: removeShell(),
    };
  }

  if ((context.isHomebrewInstallAvailable ?? defaultHomebrewInstallAvailable)()) {
    const plan = buildHomebrewUninstallPlan();

    context.onBeforeHomebrewUninstall?.(plan.displayCommand);
    (context.runHomebrewUninstall ?? runHomebrewUninstall)(plan);

    return {
      strategy: "homebrew",
      delegatedCommand: plan.displayCommand,
      shellIntegration: removeShell(),
    };
  }

  throw new AppError(
    "Could not find an installed wt binary to uninstall. If you are running from a source checkout, use `./uninstall.sh` or remove the installed binary manually."
  );
}
