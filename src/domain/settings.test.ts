import { describe, expect, test } from "bun:test";
import {
  DEFAULT_WT_SETTINGS,
  normalizeSettings,
} from "./settings.js";

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
