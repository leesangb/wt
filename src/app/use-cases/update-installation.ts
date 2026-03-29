import { AppError } from "../errors.js";
import {
  downloadBinary,
  removeMacosQuarantine,
  replaceCurrentBinary,
} from "../../infra/update/binary-installer.js";
import {
  fetchLatestRelease,
  getReleaseAssetDownloadUrl,
  getSupportedMacosAssetName,
} from "../../infra/update/github-release-provider.js";
import {
  buildHomebrewUpdatePlan,
  isHomebrewManagedInstallation,
  runHomebrewUpdate,
  type HomebrewProcessInfo,
  type HomebrewUpdatePlan,
} from "../../infra/update/homebrew.js";
import { compareVersions } from "../../infra/update/version.js";

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
}

export interface HomebrewDelegatedUpdateResult {
  strategy: "homebrew";
  delegatedCommand: string;
}

export type UpdateInstallationResult =
  | StandaloneUpdateInstallationResult
  | HomebrewDelegatedUpdateResult;

export type UpdateStrategy = "standalone" | "homebrew";

export interface UpdateInstallationContext {
  processInfo?: HomebrewProcessInfo;
  onBeforeHomebrewUpdate?: (command: string) => void;
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

async function updateStandaloneInstallation(
  currentVersion: string,
  options: UpdateInstallationOptions
): Promise<StandaloneUpdateInstallationResult> {
  if (process.platform !== "darwin") {
    throw new AppError(
      "Update command currently supports only macOS (darwin)."
    );
  }

  const assetName = getSupportedMacosAssetName(process.arch);

  if (!assetName) {
    throw new AppError(`Unsupported architecture: ${process.arch}`);
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

  const tempPath = await downloadBinary(downloadUrl);
  const execPath = process.execPath;
  replaceCurrentBinary(tempPath, execPath);

  if (options.removeQuarantine !== false) {
    await removeMacosQuarantine(execPath);
  }

  return {
    strategy: "standalone",
    currentVersion,
    targetVersion,
    updated: true,
    assetName,
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

    return {
      strategy: "homebrew",
      delegatedCommand: plan.displayCommand,
    };
  }

  return updateStandaloneInstallation(currentVersion, options);
}
