import { chmodSync, mkdtempSync, renameSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { AppError } from "../../app/errors.js";

export async function downloadBinary(url: string): Promise<string> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new AppError(`Download failed with status ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const tempDir = mkdtempSync(join(tmpdir(), "wt-update-"));
  const tempPath = join(tempDir, "wt-new");

  writeFileSync(tempPath, new Uint8Array(arrayBuffer));
  chmodSync(tempPath, 0o755);

  return tempPath;
}

export function replaceCurrentBinary(
  tempPath: string,
  execPath: string = process.execPath
): void {
  try {
    renameSync(tempPath, execPath);
  } catch (error: any) {
    throw new AppError(
      `Failed to replace binary at ${execPath}: ${error.message || error}`
    );
  }
}

export async function removeMacosQuarantine(execPath: string): Promise<void> {
  if (process.platform !== "darwin") {
    return;
  }

  try {
    const { spawnSync } = await import("child_process");
    spawnSync("xattr", ["-d", "com.apple.quarantine", execPath], {
      stdio: "ignore",
    });
  } catch {}
}
