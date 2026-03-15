import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { updateInstalledShellWrappers } from "./integration.js";

const tempDirs: string[] = [];
const originalFetch = global.fetch;

function setMockFetch(
  implementation: (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>
): void {
  global.fetch = implementation as typeof fetch;
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  global.fetch = originalFetch;

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("updateInstalledShellWrappers", () => {
  test("returns warnings when wrapper downloads fail", async () => {
    const shellDir = makeTempDir("wt-shell-update-");
    writeFileSync(join(shellDir, "wt.bash"), "old");

    setMockFetch(async () => new Response("missing", { status: 404 }));

    const result = await updateInstalledShellWrappers({
      version: "1.2.3",
      binaryPath: "/tmp/wt",
      shellDir,
    });

    expect(result.updatedScripts).toEqual([]);
    expect(result.warnings).toEqual([
      "Could not download wt.bash (status 404)",
    ]);
    expect(readFileSync(join(shellDir, "wt.bash"), "utf-8")).toBe("old");
  });

  test("updates scripts and replaces the wrapper placeholder", async () => {
    const shellDir = makeTempDir("wt-shell-update-");
    writeFileSync(join(shellDir, "wt.zsh"), "/path/to/wt");

    setMockFetch(
      async () =>
        new Response('exec /path/to/wt "$@"', {
          status: 200,
        })
    );

    const result = await updateInstalledShellWrappers({
      version: "1.2.3",
      binaryPath: "/usr/local/bin/wt",
      shellDir,
    });

    expect(result.updatedScripts).toEqual(["wt.zsh"]);
    expect(result.warnings).toEqual([]);
    expect(readFileSync(join(shellDir, "wt.zsh"), "utf-8")).toBe(
      'exec /usr/local/bin/wt "$@"'
    );
  });
});
