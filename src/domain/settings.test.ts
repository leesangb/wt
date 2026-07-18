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

  test("merges local Herdr refresh overrides without dropping shared intervals", () => {
    expect(
      mergeSettingsInputs(
        {
          herdr: {
            refresh: {
              focusedSeconds: 20,
              backgroundSeconds: 240,
            },
          },
        },
        {
          herdr: {
            refresh: {
              backgroundSeconds: 600,
            },
          },
        }
      )
    ).toEqual({
      herdr: {
        refresh: {
          focusedSeconds: 20,
          backgroundSeconds: 600,
        },
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
      herdr: {
        closeWorkspaceOnRemove: true,
        refresh: {
          focusedSeconds: 30,
          backgroundSeconds: 300,
          pullRequestSeconds: 300,
        },
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
      herdr: {
        closeWorkspaceOnRemove: true,
        refresh: {
          focusedSeconds: 30,
          backgroundSeconds: 300,
          pullRequestSeconds: 300,
        },
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

  test("allows automatic Herdr workspace closing to be disabled", () => {
    expect(
      normalizeSettings({
        herdr: {
          closeWorkspaceOnRemove: false,
        },
      }).herdr
    ).toEqual({
      closeWorkspaceOnRemove: false,
      refresh: {
        focusedSeconds: 30,
        backgroundSeconds: 300,
        pullRequestSeconds: 300,
      },
    });
  });

  test("normalizes configurable Herdr refresh intervals in seconds", () => {
    expect(
      normalizeSettings({
        herdr: {
          refresh: {
            focusedSeconds: 12,
            backgroundSeconds: 90,
            pullRequestSeconds: 120,
          },
        },
      }).herdr.refresh
    ).toEqual({
      focusedSeconds: 12,
      backgroundSeconds: 90,
      pullRequestSeconds: 120,
    });
  });

  test("clamps Herdr refresh intervals to safe minimums", () => {
    expect(
      normalizeSettings({
        herdr: {
          refresh: {
            focusedSeconds: 1,
            backgroundSeconds: 2,
            pullRequestSeconds: 3,
          },
        },
      }).herdr.refresh
    ).toEqual({
      focusedSeconds: 5,
      backgroundSeconds: 30,
      pullRequestSeconds: 60,
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
      herdr: {
        closeWorkspaceOnRemove: true,
        refresh: {
          focusedSeconds: 30,
          backgroundSeconds: 300,
          pullRequestSeconds: 300,
        },
      },
    });
  });
});
