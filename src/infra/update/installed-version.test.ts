import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readInstalledWtVersion } from "./installed-version.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("readInstalledWtVersion", () => {
  test("reads the semantic version from the installed binary", () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-version-"));
    tempDirs.push(dir);
    const binary = join(dir, "wt");
    writeFileSync(binary, "#!/bin/sh\nprintf 'wt 1.2.3\\n'\n", { mode: 0o755 });

    expect(readInstalledWtVersion(binary)).toBe("1.2.3");
  });
});
