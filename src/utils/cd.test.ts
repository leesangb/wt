import { describe, expect, test } from "bun:test";
import {
  buildCdOutput,
  CD_OUTPUT_PREFIX,
  formatCdCommand,
  parseCdOutput,
  quoteShellPath,
} from "./cd.js";

describe("cd output helpers", () => {
  test("builds and parses shell wrapper output without losing spaces", () => {
    const path = "/tmp/wt space/repo-feature";
    const output = buildCdOutput(path);

    expect(output).toBe(`${CD_OUTPUT_PREFIX}${path}`);
    expect(parseCdOutput(output)).toBe(path);
  });

  test("returns null for non-cd output", () => {
    expect(parseCdOutput("cd /tmp/wt")).toBeNull();
  });

  test("quotes shell commands safely for manual copy-paste", () => {
    const path = "/tmp/it's here/repo";

    expect(quoteShellPath(path)).toBe(`'/tmp/it'"'"'s here/repo'`);
    expect(formatCdCommand(path)).toBe(`cd '/tmp/it'"'"'s here/repo'`);
  });
});
