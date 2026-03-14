import { describe, expect, test } from "bun:test";
import { generateCompletion, generateShellHook } from "./shell.js";

describe("generateShellHook", () => {
  test("embeds the binary path for zsh hook generation", () => {
    const script = generateShellHook("zsh", "/tmp/wt");

    expect(script).toContain('__wt_bin="/tmp/wt"');
    expect(script).toContain('if [ "$1" = "new" ] || [ "$1" = "cd" ]; then');
    expect(script).toContain("printf '%s\\n' \"$output\"");
    expect(script).toContain("tr -d '\\n'");
  });
});

describe("generateCompletion", () => {
  test("includes generated command names for bash", () => {
    const script = generateCompletion("bash", "/tmp/wt");

    expect(script).toContain("completion shell-hook");
    expect(script).toContain('__wt_completion_bin="/tmp/wt"');
  });

  test("supports dynamic worktree completion for fish", () => {
    const script = generateCompletion("fish", "/tmp/wt");

    expect(script).toContain("list --completion fish");
    expect(script).toContain("cd remove rm");
  });
});
