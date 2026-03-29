import {
  fetchReleaseByTag,
  type GithubReleaseAsset,
} from "../infra/update/github-release-provider.js";

function getAssetDigest(
  assets: GithubReleaseAsset[],
  assetName: string
): string {
  const asset = assets.find((entry) => entry.name === assetName);

  if (!asset) {
    throw new Error(`Could not find release asset: ${assetName}`);
  }

  if (!asset.digest?.startsWith("sha256:")) {
    throw new Error(`Release asset ${assetName} is missing a sha256 digest`);
  }

  return asset.digest.slice("sha256:".length);
}

const version = process.argv[2];

if (!version) {
  throw new Error(
    "Usage: bun run src/scripts/export-homebrew-release-env.ts <version>"
  );
}

const release = await fetchReleaseByTag(version);
const normalizedVersion = release.tagName.replace(/^v/, "");

if (!normalizedVersion) {
  throw new Error(`Could not determine release version for ${version}`);
}

console.log(`WT_VERSION=${normalizedVersion}`);
console.log(
  `WT_MACOS_ARM64_SHA256=${getAssetDigest(release.assets, "wt-macos-arm64")}`
);
console.log(
  `WT_MACOS_X64_SHA256=${getAssetDigest(release.assets, "wt-macos-x64")}`
);
