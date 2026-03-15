import { homedir } from "os";
import { join } from "path";
import { AppError } from "../errors.js";
import { updateInstalledShellWrappers } from "../../infra/shell/integration.js";
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
import { compareVersions } from "../../infra/update/version.js";

export interface UpdateInstallationOptions {
  force?: boolean;
  version?: string;
  removeQuarantine?: boolean;
}

export interface UpdateInstallationResult {
  currentVersion: string;
  targetVersion?: string;
  updated: boolean;
  assetName?: string;
  shellScriptsUpdated: string[];
  shellScriptsSkipped: boolean;
}

export async function updateInstallation(
  currentVersion: string,
  options: UpdateInstallationOptions
): Promise<UpdateInstallationResult> {
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

    if (compareVersions(targetVersion, currentVersion) <= 0 && !options.force) {
      return {
        currentVersion,
        targetVersion,
        updated: false,
        assetName,
        shellScriptsUpdated: [],
        shellScriptsSkipped: false,
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
    if (compareVersions(targetVersion, currentVersion) <= 0 && !options.force) {
      return {
        currentVersion,
        targetVersion,
        updated: false,
        assetName,
        shellScriptsUpdated: [],
        shellScriptsSkipped: false,
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

  const shellDir = join(homedir(), ".wt", "shell");
  const shellUpdate = await updateInstalledShellWrappers({
    version: targetVersion,
    binaryPath: execPath,
    shellDir,
  });

  return {
    currentVersion,
    targetVersion,
    updated: true,
    assetName,
    shellScriptsUpdated: shellUpdate.updatedScripts,
    shellScriptsSkipped: shellUpdate.skipped,
  };
}
