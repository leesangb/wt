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
});
