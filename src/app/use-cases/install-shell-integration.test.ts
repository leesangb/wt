import { describe, expect, test } from "bun:test";
import { resolveDefaultShellCommand } from "./install-shell-integration.js";

describe("resolveDefaultShellCommand", () => {
  test("preserves the invoked binary path for symlinked compiled installs", () => {
    expect(
      resolveDefaultShellCommand({
        argv0: "/opt/homebrew/bin/wt",
        argv: ["bun", "/$bunfs/root/wt"],
        execPath: "/opt/homebrew/Cellar/wt/0.2.7/bin/wt",
      })
    ).toEqual(["/opt/homebrew/bin/wt"]);
  });

  test("uses the runtime and script path when launched through bun", () => {
    expect(
      resolveDefaultShellCommand({
        argv0: "bun",
        argv: ["/Users/test/.bun/bin/bun", "/tmp/wt.ts"],
        execPath: "/Users/test/.bun/bin/bun",
      })
    ).toEqual(["/Users/test/.bun/bin/bun", "/tmp/wt.ts"]);
  });

  test("keeps the script path when the Bun executable is named bun.exe", () => {
    expect(
      resolveDefaultShellCommand({
        argv0: "/Users/test/.bun/install/global/node_modules/bun/bin/bun.exe",
        argv: [
          "/Users/test/.bun/install/global/node_modules/bun/bin/bun.exe",
          "/tmp/wt.ts",
        ],
        execPath: "/Users/test/.bun/install/global/node_modules/bun/bin/bun.exe",
      })
    ).toEqual([
      "/Users/test/.bun/install/global/node_modules/bun/bin/bun.exe",
      "/tmp/wt.ts",
    ]);
  });

  test("falls back to execPath when argv0 is only a PATH-resolved command name", () => {
    expect(
      resolveDefaultShellCommand({
        argv0: "wt",
        argv: ["bun", "/$bunfs/root/wt"],
        execPath: "/opt/homebrew/bin/wt",
      })
    ).toEqual(["/opt/homebrew/bin/wt"]);
  });
});
