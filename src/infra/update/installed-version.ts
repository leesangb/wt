import { spawnSync } from "node:child_process";

export function readInstalledWtVersion(binaryPath: string): string {
  const result = spawnSync(binaryPath, ["--version"], {
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() ||
        `${binaryPath} --version exited with code ${result.status ?? "unknown"}`
    );
  }

  const match = result.stdout.trim().match(/(?:^|\s)v?(\d+\.\d+\.\d+)(?:\s|$)/);
  if (!match?.[1]) {
    throw new Error(`Could not read the installed wt version from ${binaryPath}`);
  }

  return match[1];
}
