import { AppError } from "../../app/errors.js";

interface GithubReleaseApiAsset {
  name?: string;
  browser_download_url?: string;
  digest?: string;
}

interface GithubReleaseApiResponse {
  tag_name?: string;
  assets?: GithubReleaseApiAsset[];
}

export interface GithubReleaseAsset {
  name: string;
  browserDownloadUrl: string;
  digest?: string;
}

export interface GithubRelease {
  tagName: string;
  assets: GithubReleaseAsset[];
}

async function fetchRelease(path: string): Promise<GithubRelease> {
  const response = await fetch(
    `https://api.github.com/repos/leesangb/wt/releases/${path}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "wt-update",
      },
    }
  );

  if (!response.ok) {
    throw new AppError(
      `Failed to query latest release: ${response.status}`
    );
  }

  const release = (await response.json()) as GithubReleaseApiResponse;

  return {
    tagName: release.tag_name ?? "",
    assets: (release.assets ?? [])
      .filter(
        (asset): asset is Required<GithubReleaseApiAsset> =>
          Boolean(asset.name) && Boolean(asset.browser_download_url)
      )
      .map((asset) => ({
        name: asset.name,
        browserDownloadUrl: asset.browser_download_url,
        digest: asset.digest,
      })),
  };
}

export async function fetchLatestRelease(): Promise<GithubRelease> {
  return fetchRelease("latest");
}

export async function fetchReleaseByTag(version: string): Promise<GithubRelease> {
  return fetchRelease(`tags/v${version.replace(/^v/, "")}`);
}

export function getSupportedMacosAssetName(
  architecture: string
): string | undefined {
  if (architecture === "arm64") {
    return "wt-macos-arm64";
  }

  if (architecture === "x64") {
    return "wt-macos-x64";
  }

  return undefined;
}

export function getReleaseAssetDownloadUrl(
  version: string,
  assetName: string
): string {
  return `https://github.com/leesangb/wt/releases/download/v${version}/${assetName}`;
}
