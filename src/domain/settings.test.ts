import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WT_SETTINGS,
  mergeSettingsInputs,
  normalizeSettings,
} from "./settings.js";

describe("mergeSettingsInputs", () => {
  test("returns undefined when both inputs are missing", () => {
    expect(mergeSettingsInputs()).toBeUndefined();
  });

  test("merges nested script overrides without dropping sibling fields", () => {
    expect(
      mergeSettingsInputs(
        {
          worktreeDir: "/tmp/worktrees",
          scripts: {
            pre: ["echo pre"],
            post: ["bun install"],
          },
        },
        {
          baseBranch: "develop",
          scripts: {
            postMode: "sync",
          },
        }
      )
    ).toEqual({
      worktreeDir: "/tmp/worktrees",
      baseBranch: "develop",
      scripts: {
        pre: ["echo pre"],
        post: ["bun install"],
        postMode: "sync",
      },
    });
  });
});

describe("normalizeSettings", () => {
  test("returns the full default configuration when input is missing", () => {
    expect(normalizeSettings()).toEqual(DEFAULT_WT_SETTINGS);
  });

  test("merges partial nested settings without dropping defaults", () => {
    expect(
      normalizeSettings({
        worktreeDir: "/tmp/worktrees",
        scripts: {
          post: ["pnpm install"],
        },
      })
    ).toEqual({
      worktreeDir: "/tmp/worktrees",
      baseBranch: "main",
      pushRemote: true,
      scripts: {
        pre: [],
        post: ["pnpm install"],
        postMode: "async",
      },
    });
  });
});
