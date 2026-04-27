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
          copy: {
            include: [".env"],
          },
          scripts: {
            pre: ["echo pre"],
            post: ["bun install"],
          },
        },
        {
          baseBranch: "develop",
          copy: {
            exclude: ["node_modules/**"],
          },
          scripts: {
            postMode: "sync",
          },
        }
      )
    ).toEqual({
      worktreeDir: "/tmp/worktrees",
      baseBranch: "develop",
      copy: {
        include: [".env"],
        exclude: ["node_modules/**"],
      },
      scripts: {
        pre: ["echo pre"],
        post: ["bun install"],
        postMode: "sync",
      },
    });
  });

  test("merges nested issue overrides without dropping sibling fields", () => {
    expect(
      mergeSettingsInputs(
        {
          issue: {
            pattern: "[A-Z]+-\\d+",
            url: "https://old.example/$issue",
          },
        },
        {
          issue: {
            url: "https://new.example/$issue",
          },
        }
      )
    ).toEqual({
      issue: {
        pattern: "[A-Z]+-\\d+",
        url: "https://new.example/$issue",
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
      copy: {
        include: [],
        exclude: [],
      },
      scripts: {
        pre: [],
        post: ["pnpm install"],
        postMode: "async",
      },
    });
  });

  test("preserves copy and exclude arrays", () => {
    expect(
      normalizeSettings({
        copy: {
          include: [".env", ".wt/settings.local.json"],
          exclude: ["node_modules/**", ".wt/.gitignore"],
        },
      })
    ).toEqual({
      worktreeDir: "~/.wt",
      baseBranch: "main",
      pushRemote: true,
      copy: {
        include: [".env", ".wt/settings.local.json"],
        exclude: ["node_modules/**", ".wt/.gitignore"],
      },
      scripts: {
        pre: [],
        post: [],
        postMode: "async",
      },
    });
  });

  test("preserves issue tracker settings", () => {
    expect(
      normalizeSettings({
        issue: {
          pattern: "[A-Z]+-\\d+",
          url: "https://myissues.com/$issue",
        },
      }).issue
    ).toEqual({
      pattern: "[A-Z]+-\\d+",
      url: "https://myissues.com/$issue",
    });
  });

  test("accepts legacy copy arrays and normalizes them to copy.include", () => {
    expect(
      normalizeSettings({
        copy: [".env", ".env.local"],
      })
    ).toEqual({
      worktreeDir: "~/.wt",
      baseBranch: "main",
      pushRemote: true,
      copy: {
        include: [".env", ".env.local"],
        exclude: [],
      },
      scripts: {
        pre: [],
        post: [],
        postMode: "async",
      },
    });
  });
});
