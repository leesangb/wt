import { AppError } from "../errors.js";
import { basename, resolve } from "path";
import {
  refreshExistingShellWrappers,
  type RefreshShellWrappersResult,
} from "../../infra/shell/installer.js";
import {
  downloadBinary as defaultDownloadBinary,
  removeMacosQuarantine as defaultRemoveMacosQuarantine,
  replaceCurrentBinary as defaultReplaceCurrentBinary,
} from "../../infra/update/binary-installer.js";
import {
  fetchLatestRelease,
  getReleaseAssetDownloadUrl,
  getSupportedMacosAssetName,
} from "../../infra/update/github-release-provider.js";
import {
  buildHomebrewUpdatePlan,
  isHomebrewManagedInstallation,
  resolveHomebrewShellBinaryPath,
  runHomebrewUpdate,
  type HomebrewProcessInfo,
  type HomebrewUpdatePlan,
} from "../../infra/update/homebrew.js";
import { compareVersions } from "../../infra/update/version.js";

const BINARY_NAME = "wt";
const RUNTIME_LAUNCHERS = new Set(["bun", "node"]);

export interface UpdateInstallationOptions {
  force?: boolean;
  version?: string;
  removeQuarantine?: boolean;
}

export interface StandaloneUpdateInstallationResult {
  strategy: "standalone";
  currentVersion: string;
  targetVersion?: string;
  updated: boolean;
  assetName?: string;
  shellIntegration?: RefreshShellWrappersResult;
}

export interface HomebrewDelegatedUpdateResult {
  strategy: "homebrew";
  delegatedCommand: string;
  shellIntegration: RefreshShellWrappersResult;
}

export type UpdateInstallationResult =
  | StandaloneUpdateInstallationResult
  | HomebrewDelegatedUpdateResult;

export type UpdateStrategy = "standalone" | "homebrew";

export interface UpdateInstallationContext {
  processInfo?: HomebrewProcessInfo;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  downloadBinary?: (url: string) => Promise<string>;
  onBeforeHomebrewUpdate?: (command: string) => void;
  refreshShellWrappers?: (binaryPath: string) => RefreshShellWrappersResult;
  removeMacosQuarantine?: (execPath: string) => Promise<void>;
  replaceCurrentBinary?: (tempPath: string, execPath: string) => void;
  runHomebrewUpdate?: (plan: HomebrewUpdatePlan) => void;
}

function assertVersionFormat(version: string, label: string): void {
  try {
    compareVersions(version, version);
  } catch {
    throw new AppError(`Invalid ${label} version "${version}"`);
  }
}

export function getUpdateStrategy(
  processInfo?: HomebrewProcessInfo
): UpdateStrategy {
  return isHomebrewManagedInstallation(processInfo) ? "homebrew" : "standalone";
}

function looksLikePath(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  return value.includes("/") || value.includes("\\");
}

function resolveCurrentStandaloneBinaryPath(
  processInfo: HomebrewProcessInfo = {
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

  if (
    looksLikePath(argv0) &&
    !RUNTIME_LAUNCHERS.has(launcherName) &&
    basename(argv0).toLowerCase() === BINARY_NAME
  ) {
    return resolve(argv0);
  }

  return undefined;
}

function refreshShellWrappers(
  binaryPath: string,
  context: UpdateInstallationContext
): RefreshShellWrappersResult {
  return (
    context.refreshShellWrappers ??
    ((path) => refreshExistingShellWrappers({ binaryPath: path }))
  )(binaryPath);
}

async function updateStandaloneInstallation(
  currentVersion: string,
  options: UpdateInstallationOptions,
  context: UpdateInstallationContext
): Promise<StandaloneUpdateInstallationResult> {
  const platform = context.platform ?? process.platform;
  const arch = context.arch ?? process.arch;

  if (platform !== "darwin") {
    throw new AppError(
      "Update command currently supports only macOS (darwin)."
    );
  }

  const binaryPath = resolveCurrentStandaloneBinaryPath(context.processInfo);

  if (!binaryPath) {
    throw new AppError(
      "Could not determine the standalone wt binary to update. If you are running from a source checkout, use `./install.sh --force` or install a release binary first."
    );
  }

  const assetName = getSupportedMacosAssetName(arch);

  if (!assetName) {
    throw new AppError(`Unsupported architecture: ${arch}`);
  }

  let targetVersion = options.version?.replace(/^v/, "");
  let downloadUrl: string | undefined;

  if (!targetVersion) {
    const release = await fetchLatestRelease();
    targetVersion = release.tagName.replace(/^v/, "");

    if (!targetVersion) {
      throw new AppError("Could not determine latest version");
    }

    assertVersionFormat(targetVersion, "release");

    if (compareVersions(targetVersion, currentVersion) <= 0 && !options.force) {
      return {
        strategy: "standalone",
        currentVersion,
        targetVersion,
        updated: false,
        assetName,
      };
    }

    const asset = release.assets.find((entry) => entry.name === assetName);

    if (!asset) {
      throw new AppError(
        `Could not find asset ${assetName} in latest release.`
      );
    }

    downloadUrl = asset.browserDownloadUrl;
  } else {
    assertVersionFormat(targetVersion, "requested");

    if (compareVersions(targetVersion, currentVersion) <= 0 && !options.force) {
      return {
        strategy: "standalone",
        currentVersion,
        targetVersion,
        updated: false,
        assetName,
      };
    }

    downloadUrl = getReleaseAssetDownloadUrl(targetVersion, assetName);
  }

  const tempPath = await (context.downloadBinary ?? defaultDownloadBinary)(
    downloadUrl
  );
  (context.replaceCurrentBinary ?? defaultReplaceCurrentBinary)(
    tempPath,
    binaryPath
  );

  if (options.removeQuarantine !== false) {
    await (context.removeMacosQuarantine ?? defaultRemoveMacosQuarantine)(
      binaryPath
    );
  }

  const shellIntegration = refreshShellWrappers(binaryPath, context);

  return {
    strategy: "standalone",
    currentVersion,
    targetVersion,
    updated: true,
    assetName,
    shellIntegration,
  };
}

export async function updateInstallation(
  currentVersion: string,
  options: UpdateInstallationOptions,
  context: UpdateInstallationContext = {}
): Promise<UpdateInstallationResult> {
  assertVersionFormat(currentVersion, "current");

  if (getUpdateStrategy(context.processInfo) === "homebrew") {
    const plan = buildHomebrewUpdatePlan(options);

    context.onBeforeHomebrewUpdate?.(plan.displayCommand);
    (context.runHomebrewUpdate ?? runHomebrewUpdate)(plan);
    const shellIntegration = refreshShellWrappers(
      resolveHomebrewShellBinaryPath(context.processInfo),
      context
    );

    return {
      strategy: "homebrew",
      delegatedCommand: plan.displayCommand,
      shellIntegration,
    };
  }

  return updateStandaloneInstallation(currentVersion, options, context);
}
