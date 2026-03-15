import { basename } from "path";
import { $ } from "bun";

export async function isGitRepository(
  cwd: string = process.cwd()
): Promise<boolean> {
  try {
    await $`git -C ${cwd} rev-parse --git-dir`.quiet();
    return true;
  } catch {
    return false;
  }
}

export async function getGitRoot(
  cwd: string = process.cwd()
): Promise<string> {
  const result = await $`git -C ${cwd} rev-parse --show-toplevel`.text();
  return result.trim();
}

export async function getRepoName(repoRoot: string): Promise<string> {
  try {
    const remoteUrl = await $`git -C ${repoRoot} remote get-url origin`.text();
    const url = remoteUrl.trim();
    const match = url.match(/\/([^/]+?)(?:\.git)?$/);

    if (match) {
      return match[1];
    }
  } catch {}

  return basename(repoRoot);
}
