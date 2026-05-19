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
  ensureRemoveTaskArtifactsIgnored,
  loadSettings,
  LOCAL_SETTINGS_GITIGNORE_ENTRY,
  REMOVE_TASK_GITIGNORE_ENTRIES,
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
    const settingsDir = join(repoRoot, ".wt");

    mkdirSync(settingsDir, { recursive: true });
    await expect(ensureLocalSettingsIgnored(repoRoot)).resolves.toBe(true);
    expect(readFileSync(join(settingsDir, ".gitignore"), "utf-8")).toBe(
      `${LOCAL_SETTINGS_GITIGNORE_ENTRY}\n`
    );
  });

  test("does not duplicate the local settings ignore entry", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");
    const settingsDir = join(repoRoot, ".wt");
    const gitignorePath = join(settingsDir, ".gitignore");

    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(gitignorePath, "settings.json\nsettings.local.json\n");

    await expect(ensureLocalSettingsIgnored(repoRoot)).resolves.toBe(false);
    expect(readFileSync(gitignorePath, "utf-8")).toBe(
      "settings.json\nsettings.local.json\n"
    );
  });

  test("adds remove task artifact ignore entries", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");
    const settingsDir = join(repoRoot, ".wt");

    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(join(settingsDir, ".gitignore"), "settings.local.json\n");

    await expect(ensureRemoveTaskArtifactsIgnored(repoRoot)).resolves.toBe(true);
    expect(readFileSync(join(settingsDir, ".gitignore"), "utf-8")).toBe(
      [
        "settings.local.json",
        ...REMOVE_TASK_GITIGNORE_ENTRIES,
        "",
      ].join("\n")
    );
  });

  test("does not duplicate remove task artifact ignore entries", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");
    const settingsDir = join(repoRoot, ".wt");
    const gitignorePath = join(settingsDir, ".gitignore");

    mkdirSync(settingsDir, { recursive: true });
    writeFileSync(
      gitignorePath,
      ["settings.local.json", ...REMOVE_TASK_GITIGNORE_ENTRIES, ""].join("\n")
    );

    await expect(ensureRemoveTaskArtifactsIgnored(repoRoot)).resolves.toBe(false);
    expect(readFileSync(gitignorePath, "utf-8")).toBe(
      ["settings.local.json", ...REMOVE_TASK_GITIGNORE_ENTRIES, ""].join("\n")
    );
  });

  test("returns defaults when no settings files exist", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");

    await expect(loadSettings(repoRoot)).resolves.toEqual({
      worktreeDir: "~/.wt",
      baseBranch: "main",
      pushRemote: true,
      copy: {
        include: [],
        exclude: [],
      },
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
      copy: {
        include: [],
        exclude: [],
      },
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
      copy: {
        include: [".env"],
      },
      scripts: {
        pre: ["echo pre"],
        post: ["bun install"],
        postMode: "async",
      },
    });
    writeJson(join(wtDir, "settings.local.json"), {
      baseBranch: "develop",
      copy: {
        exclude: ["node_modules/**"],
      },
      scripts: {
        postMode: "sync",
      },
    });

    await expect(loadSettings(repoRoot)).resolves.toEqual({
      worktreeDir: "/tmp/worktrees",
      baseBranch: "develop",
      pushRemote: true,
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

  test("lets local settings override copy and exclude arrays", async () => {
    const repoRoot = makeTempDir("wt-settings-store-");
    const wtDir = join(repoRoot, ".wt");

    mkdirSync(wtDir, { recursive: true });
    writeJson(join(wtDir, "settings.json"), {
      copy: {
        include: [".env"],
        exclude: ["dist/**"],
      },
    });
    writeJson(join(wtDir, "settings.local.json"), {
      copy: {
        include: [".env.local"],
        exclude: ["coverage/**"],
      },
    });

    await expect(loadSettings(repoRoot)).resolves.toEqual({
      worktreeDir: "~/.wt",
      baseBranch: "main",
      pushRemote: true,
      copy: {
        include: [".env.local"],
        exclude: ["coverage/**"],
      },
      scripts: {
        pre: [],
        post: [],
        postMode: "async",
      },
    });
  });
});
