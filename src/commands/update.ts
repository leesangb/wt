import chalk from "chalk";
import { mkdtempSync, writeFileSync, chmodSync, renameSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

interface UpdateOptions {
  force?: boolean;
  version?: string;
  removeQuarantine?: boolean;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(n => parseInt(n, 10));
  const pb = b.split('.').map(n => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

export async function updateCommand(options: UpdateOptions): Promise<void> {
  const currentVersion = (await import("../../package.json")).default.version as string;

  // Determine architecture / platform support
  if (process.platform !== 'darwin') {
    console.error(chalk.red('Update command currently supports only macOS (darwin).'));
    process.exit(1);
  }

  let targetVersion = options.version?.replace(/^v/, '');
  let fromReleaseApi = false;

  try {
    if (!targetVersion) {
      const latestResp = await fetch('https://api.github.com/repos/leesangb/wt/releases/latest', {
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'wt-update' },
      });
      if (!latestResp.ok) {
        throw new Error(`Failed to query latest release: ${latestResp.status}`);
      }
      const latestJson: any = await latestResp.json();
      targetVersion = (latestJson.tag_name || '').replace(/^v/, '');
      fromReleaseApi = true;

      if (!targetVersion) {
        throw new Error('Could not determine latest version');
      }

      const cmp = compareVersions(targetVersion, currentVersion);
      if (cmp <= 0 && !options.force) {
        console.log(chalk.green(`wt is up to date (current ${currentVersion}, latest ${targetVersion}).`));
        console.log(chalk.dim('Use --force to re-download the current version.'));
        return;
      }

      const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined;
      if (!arch) {
        console.error(chalk.red(`Unsupported architecture: ${process.arch}`));
        process.exit(1);
      }

      const expectedName = arch === 'arm64' ? 'wt-macos-arm64' : 'wt-macos-x64';
      const asset = (latestJson.assets || []).find((a: any) => a.name === expectedName);
      if (!asset) {
        console.error(chalk.red(`Could not find asset ${expectedName} in latest release.`));
        process.exit(1);
      }

      await downloadAndSwapBinary(asset.browser_download_url, targetVersion!, expectedName, options.removeQuarantine !== false);
      return;
    } else {
      // Specific version flow
      const arch = process.arch === 'arm64' ? 'arm64' : process.arch === 'x64' ? 'x64' : undefined;
      if (!arch) {
        console.error(chalk.red(`Unsupported architecture: ${process.arch}`));
        process.exit(1);
      }
      const expectedName = arch === 'arm64' ? 'wt-macos-arm64' : 'wt-macos-x64';
      const url = `https://github.com/leesangb/wt/releases/download/v${targetVersion}/${expectedName}`;
      if (compareVersions(targetVersion, currentVersion) <= 0 && !options.force) {
        console.log(chalk.yellow(`Target version (${targetVersion}) is not newer than current (${currentVersion}). Use --force to overwrite.`));
        return;
      }
      await downloadAndSwapBinary(url, targetVersion, expectedName, options.removeQuarantine !== false);
    }
  } catch (err: any) {
    console.error(chalk.red(`Update failed: ${err.message || err}`));
    if (!fromReleaseApi) {
      console.error(chalk.dim('Ensure the version exists or check your network.'));
    }
    process.exit(1);
  }
}

async function downloadAndSwapBinary(url: string, version: string, assetName: string, attemptQuarantineRemoval: boolean) {
  console.log(chalk.blue(`Downloading ${assetName} (${version})...`));
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Download failed with status ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();

  const tempDir = mkdtempSync(join(tmpdir(), 'wt-update-'));
  const tempPath = join(tempDir, 'wt-new');
  writeFileSync(tempPath, new Uint8Array(arrayBuffer));
  chmodSync(tempPath, 0o755);

  const execPath = process.execPath;
  try {
    renameSync(tempPath, execPath);
  } catch (e: any) {
    console.error(chalk.red(`Failed to replace binary at ${execPath}: ${e.message}`));
    console.log(chalk.yellow('You may need elevated permissions (e.g., rerun with sudo) or install wt in a user-writable PATH directory.'));
    throw e;
  }

  if (attemptQuarantineRemoval && process.platform === 'darwin') {
    try {
      const { spawnSync } = await import('child_process');
      spawnSync('xattr', ['-d', 'com.apple.quarantine', execPath], { stdio: 'ignore' });
    } catch {
      // ignore
    }
  }

  console.log(chalk.green(`✓ Updated wt to version ${version}`));
  console.log(chalk.dim('Run: wt --version to verify.'));
}
