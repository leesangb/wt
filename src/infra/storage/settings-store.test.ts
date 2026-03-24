import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ensureLocalSettingsIgnored,
  loadSettings,
  LOCAL_SETTINGS_GITIGNORE_ENTRY,
} from "./settings-store.js";

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeJson(path: string, content: unknown): void {
  writeFileSync(path, JSON.stringify(content, null, 2));
}

describe("settings store", () => {
  test("adds the local settings ignore entry to .gitignore", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");

    await expect(ensureLocalSettingsIgnored(repoRoot)).resolves.toBe(true);
    expect(readFileSync(join(repoRoot, ".gitignore"), "utf-8")).toBe(
      `${LOCAL_SETTINGS_GITIGNORE_ENTRY}\n`
    );
  });

  test("does not duplicate the local settings ignore entry", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");
    const gitignorePath = join(repoRoot, ".gitignore");

    writeFileSync(gitignorePath, "node_modules/\n.wt/settings.local.json\n");

    await expect(ensureLocalSettingsIgnored(repoRoot)).resolves.toBe(false);
    expect(readFileSync(gitignorePath, "utf-8")).toBe(
      "node_modules/\n.wt/settings.local.json\n"
    );
  });

  test("returns defaults when no settings files exist", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");

    await expect(loadSettings(repoRoot)).resolves.toEqual({
      worktreeDir: "~/.wt",
      baseBranch: "main",
      pushRemote: true,
      scripts: {
        pre: [],
        post: [],
        postMode: "async",
      },
    });
  });

  test("loads shared settings when no local override exists", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");
    const wtDir = join(repoRoot, ".wt");

    mkdirSync(wtDir, { recursive: true });
    writeJson(join(wtDir, "settings.json"), {
      worktreeDir: "/tmp/worktrees",
      pushRemote: false,
    });

    await expect(loadSettings(repoRoot)).resolves.toEqual({
      worktreeDir: "/tmp/worktrees",
      baseBranch: "main",
      pushRemote: false,
      scripts: {
        pre: [],
        post: [],
        postMode: "async",
      },
    });
  });

  test("applies local overrides on top of shared settings, including nested scripts fields", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");
    const wtDir = join(repoRoot, ".wt");

    mkdirSync(wtDir, { recursive: true });
    writeJson(join(wtDir, "settings.json"), {
      worktreeDir: "/tmp/worktrees",
      baseBranch: "main",
      pushRemote: true,
      scripts: {
        pre: ["echo pre"],
        post: ["bun install"],
        postMode: "async",
      },
    });
    writeJson(join(wtDir, "settings.local.json"), {
      baseBranch: "develop",
      scripts: {
        postMode: "sync",
      },
    });

    await expect(loadSettings(repoRoot)).resolves.toEqual({
      worktreeDir: "/tmp/worktrees",
      baseBranch: "develop",
      pushRemote: true,
      scripts: {
        pre: ["echo pre"],
        post: ["bun install"],
        postMode: "sync",
      },
    });
  });

  test("uses local settings as overrides over defaults when shared settings are absent", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");
    const wtDir = join(repoRoot, ".wt");

    mkdirSync(wtDir, { recursive: true });
    writeJson(join(wtDir, "settings.local.json"), {
      pushRemote: false,
      scripts: {
        post: ["pnpm install"],
      },
    });

    await expect(loadSettings(repoRoot)).resolves.toEqual({
      worktreeDir: "~/.wt",
      baseBranch: "main",
      pushRemote: false,
      scripts: {
        pre: [],
        post: ["pnpm install"],
        postMode: "async",
      },
    });
  });
});
