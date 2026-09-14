import { $ } from "bun";
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadSettings } from "../infra/storage/settings-store.js";
import { copyConfiguredPaths } from "./worktree-copy.js";

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

describe("copyConfiguredPaths", () => {
  test("falls back to gitignore patterns and copies only matching ignored files", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, "config"));
    mkdirSync(join(repoRoot, "apps"));
    writeFileSync(
      join(repoRoot, ".gitignore"),
      ".env*\n.root-only\nconfig/\n\\#token\n\\!token\ntracked.txt\nfolder\n"
    );
    writeFileSync(
      join(repoRoot, ".worktreeinclude"),
      "# Local files\r\n\r\n.env*\r\n!.env.skip\r\n/.root-only\r\nconfig/**\r\n!config/*.example\r\nconfig/keep.example\r\n\\#token\r\n\\!token\r\nplain.txt\r\ntracked.txt\r\nfolder/\r\n"
    );
    for (const path of [
      ".env.local",
      ".env.skip",
      ".env[local]",
      ".root-only",
      "apps/.env.local",
      "apps/.root-only",
      "config/local secret.json",
      "config/skip.example",
      "config/keep.example",
      "#token",
      "!token",
      "plain.txt",
      "tracked.txt",
      "folder",
    ]) {
      writeFileSync(join(repoRoot, path), `${path}\n`);
    }
    await $`git -C ${repoRoot} init -q`;
    await $`git -C ${repoRoot} add -f tracked.txt`.quiet();

    await copyConfiguredPaths(await loadSettings(repoRoot), repoRoot, worktreePath);

    for (const path of [
      ".env.local",
      ".env[local]",
      ".root-only",
      "apps/.env.local",
      "config/local secret.json",
      "config/keep.example",
      "#token",
      "!token",
    ]) {
      expect(readFileSync(join(worktreePath, path), "utf-8")).toBe(`${path}\n`);
    }
    for (const path of [
      ".env.skip",
      "apps/.root-only",
      "config/skip.example",
      "plain.txt",
      "tracked.txt",
      "folder",
    ]) {
      expect(existsSync(join(worktreePath, path))).toBeFalse();
    }
  });

  test.each([
    { copy: { include: ["json.txt"] }, copiesJson: true },
    { copy: ["json.txt"], copiesJson: true },
    { copy: { include: [] }, copiesJson: false },
    { copy: [], copiesJson: false },
    { copy: {}, copiesJson: false },
    { copy: { exclude: ["json.txt"] }, copiesJson: false },
  ])("prefers explicit JSON copy settings: %j", async ({ copy, copiesJson }) => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, ".wt"));
    writeFileSync(join(repoRoot, ".wt/settings.json"), JSON.stringify({ copy }));
    writeFileSync(join(repoRoot, ".worktreeinclude"), ".env\n");
    writeFileSync(join(repoRoot, ".gitignore"), ".env\n");
    writeFileSync(join(repoRoot, ".env"), "local\n");
    writeFileSync(join(repoRoot, "json.txt"), "json\n");
    await $`git -C ${repoRoot} init -q`;

    await copyConfiguredPaths(await loadSettings(repoRoot), repoRoot, worktreePath);

    expect(existsSync(join(worktreePath, ".env"))).toBeFalse();
    expect(existsSync(join(worktreePath, "json.txt"))).toBe(copiesJson);
  });

  test("keeps local copy overrides ahead of shared settings and worktreeinclude", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, ".wt"));
    writeFileSync(
      join(repoRoot, ".wt/settings.json"),
      JSON.stringify({ copy: { include: ["shared.txt"] } })
    );
    writeFileSync(
      join(repoRoot, ".wt/settings.local.json"),
      JSON.stringify({ copy: { include: ["local.txt"] } })
    );
    writeFileSync(join(repoRoot, ".worktreeinclude"), ".env\n");
    writeFileSync(join(repoRoot, ".gitignore"), ".env\n");
    writeFileSync(join(repoRoot, ".env"), "env\n");
    writeFileSync(join(repoRoot, "shared.txt"), "shared\n");
    writeFileSync(join(repoRoot, "local.txt"), "local\n");
    await $`git -C ${repoRoot} init -q`;

    await copyConfiguredPaths(await loadSettings(repoRoot), repoRoot, worktreePath);

    expect(readFileSync(join(worktreePath, "local.txt"), "utf-8")).toBe("local\n");
    expect(existsSync(join(worktreePath, "shared.txt"))).toBeFalse();
    expect(existsSync(join(worktreePath, ".env"))).toBeFalse();
  });

  test("uses worktreeinclude with unrelated settings and preserves reserved paths", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = join(repoRoot, ".worktrees/new");
    const siblingWorktreePath = join(repoRoot, ".worktrees/old");

    mkdirSync(join(repoRoot, ".wt"));
    mkdirSync(join(repoRoot, "node_modules/pkg"), { recursive: true });
    writeFileSync(join(repoRoot, ".wt/settings.json"), '{"pushRemote":false}');
    writeFileSync(join(repoRoot, ".wt/settings.local.json"), '{"baseBranch":"main"}');
    writeFileSync(join(repoRoot, ".wt/meta.json"), "{}\n");
    writeFileSync(join(repoRoot, "node_modules/pkg/index.js"), "dependency\n");
    writeFileSync(join(repoRoot, "README.md"), "base\n");
    writeFileSync(join(repoRoot, ".env"), "env\n");
    writeFileSync(join(repoRoot, ".gitignore"), ".env\n.wt/\nnode_modules/\n.worktrees/\n");
    writeFileSync(join(repoRoot, ".worktreeinclude"), "**\n");
    await $`git -C ${repoRoot} init -q`;
    await $`git -C ${repoRoot} add README.md`.quiet();
    await $`git -C ${repoRoot} -c user.email=test@example.com -c user.name=tester commit -m base`.quiet();
    await $`git -C ${repoRoot} worktree add -b old ${siblingWorktreePath}`.quiet();
    await $`git -C ${repoRoot} worktree add -b new ${worktreePath}`.quiet();
    writeFileSync(join(siblingWorktreePath, ".env"), "sibling\n");
    writeFileSync(join(worktreePath, "local-only.txt"), "target\n");

    await copyConfiguredPaths(await loadSettings(repoRoot), repoRoot, worktreePath);

    expect(readFileSync(join(worktreePath, ".env"), "utf-8")).toBe("env\n");
    expect(existsSync(join(worktreePath, ".wt/settings.local.json"))).toBeTrue();
    expect(existsSync(join(worktreePath, ".wt/meta.json"))).toBeFalse();
    expect(existsSync(join(worktreePath, "node_modules"))).toBeFalse();
    expect(existsSync(join(worktreePath, ".worktrees"))).toBeFalse();
    expect(readFileSync(join(worktreePath, "local-only.txt"), "utf-8")).toBe("target\n");
  });

  test.each(["json", "worktreeinclude"])("does not overwrite target tracked files with %s rules", async (source) => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, "config"), { recursive: true });
    writeFileSync(join(repoRoot, "config", "app.json"), '{"version":"main"}\n');

    await $`git -C ${repoRoot} init -q`;
    await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
    await $`git -C ${repoRoot} config user.name tester`.quiet();
    await $`git -C ${repoRoot} checkout -b main`.quiet();
    await $`git -C ${repoRoot} add config/app.json`.quiet();
    await $`git -C ${repoRoot} commit -m main`.quiet();
    await $`git -C ${repoRoot} checkout -b source`.quiet();
    await $`git -C ${repoRoot} rm config/app.json`.quiet();
    await $`git -C ${repoRoot} commit -m remove-config`.quiet();

    mkdirSync(join(repoRoot, "config"), { recursive: true });
    writeFileSync(join(repoRoot, "config", "app.json"), '{"version":"local"}\n');
    writeFileSync(join(repoRoot, ".gitignore"), "config/\n");
    writeFileSync(join(repoRoot, ".worktreeinclude"), "config/\n");
    if (source === "json") {
      // JSON rules retain their existing behavior of skipping ignored directories.
      writeFileSync(join(repoRoot, ".gitignore"), "config/app.json\n");
    }
    await $`git -C ${repoRoot} worktree add ${worktreePath} main`.quiet();

    await copyConfiguredPaths(
      {
        copy: {
          include: source === "json" ? ["config"] : [],
          exclude: [],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(readFileSync(join(worktreePath, "config", "app.json"), "utf-8")).toBe(
      '{"version":"main"}\n'
    );
  });

  test("skips the destination worktree when it lives inside the repository", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = join(repoRoot, ".worktrees", "feature-copy");

    mkdirSync(worktreePath, { recursive: true });
    writeFileSync(join(repoRoot, ".env"), "TOKEN=repo\n");
    writeFileSync(join(worktreePath, "local-only.txt"), "worktree\n");

    await $`git -C ${repoRoot} init -q`;

    await copyConfiguredPaths(
      {
        copy: {
          include: ["**/*"],
          exclude: [],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(readFileSync(join(worktreePath, ".env"), "utf-8")).toBe("TOKEN=repo\n");
    expect(existsSync(join(worktreePath, ".worktrees"))).toBeFalse();
    expect(readFileSync(join(worktreePath, "local-only.txt"), "utf-8")).toBe("worktree\n");
  });

  test("skips sibling linked worktrees when the worktree root lives inside the repository", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const siblingWorktreePath = join(repoRoot, ".worktrees", "old");
    const worktreePath = join(repoRoot, ".worktrees", "new");

    writeFileSync(join(repoRoot, "README.md"), "base\n");
    writeFileSync(join(repoRoot, ".env"), "TOKEN=repo\n");

    await $`git -C ${repoRoot} init -q`;
    await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
    await $`git -C ${repoRoot} config user.name tester`.quiet();
    await $`git -C ${repoRoot} checkout -b main`.quiet();
    await $`git -C ${repoRoot} add README.md`.quiet();
    await $`git -C ${repoRoot} commit -m base`.quiet();
    await $`git -C ${repoRoot} worktree add -b old ${siblingWorktreePath} main`.quiet();
    await $`git -C ${repoRoot} worktree add -b new ${worktreePath} main`.quiet();

    writeFileSync(join(siblingWorktreePath, "sibling-only.txt"), "sibling\n");

    await copyConfiguredPaths(
      {
        copy: {
          include: ["**/*"],
          exclude: [],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(readFileSync(join(worktreePath, ".env"), "utf-8")).toBe("TOKEN=repo\n");
    expect(existsSync(join(worktreePath, ".worktrees", "old", "sibling-only.txt"))).toBeFalse();
  });

  test("keeps traversing directories for glob-only include patterns", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, "apps", "web"), { recursive: true });
    writeFileSync(join(repoRoot, "apps", "web", ".env.local"), "APP=1\n");

    await $`git -C ${repoRoot} init -q`;

    await copyConfiguredPaths(
      {
        copy: {
          include: ["**/.env*"],
          exclude: [],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(readFileSync(join(worktreePath, "apps", "web", ".env.local"), "utf-8")).toBe(
      "APP=1\n"
    );
  });

  test("supports trailing-slash directory patterns in include and exclude", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, "apps", "web"), { recursive: true });
    mkdirSync(join(repoRoot, "secrets"), { recursive: true });
    writeFileSync(join(repoRoot, "apps", "web", ".env.local"), "APP=1\n");
    writeFileSync(join(repoRoot, "secrets", "token.txt"), "secret\n");

    await $`git -C ${repoRoot} init -q`;

    await copyConfiguredPaths(
      {
        copy: {
          include: ["apps/"],
          exclude: ["secrets/"],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(readFileSync(join(worktreePath, "apps", "web", ".env.local"), "utf-8")).toBe(
      "APP=1\n"
    );
    expect(existsSync(join(worktreePath, "secrets"))).toBeFalse();
  });

  test("supports ./-prefixed repo-relative copy patterns", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, "apps", "web"), { recursive: true });
    mkdirSync(join(repoRoot, "secrets"), { recursive: true });
    writeFileSync(join(repoRoot, ".env"), "ROOT=1\n");
    writeFileSync(join(repoRoot, "apps", "web", ".env.local"), "APP=1\n");
    writeFileSync(join(repoRoot, "secrets", "token.txt"), "secret\n");

    await $`git -C ${repoRoot} init -q`;

    await copyConfiguredPaths(
      {
        copy: {
          include: ["./.env", "./apps/", "./secrets"],
          exclude: ["./secrets/"],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(readFileSync(join(worktreePath, ".env"), "utf-8")).toBe("ROOT=1\n");
    expect(readFileSync(join(worktreePath, "apps", "web", ".env.local"), "utf-8")).toBe(
      "APP=1\n"
    );
    expect(existsSync(join(worktreePath, "secrets"))).toBeFalse();
  });

  test("copies only untracked files even when tracked files match include patterns", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, ".wt"), { recursive: true });
    mkdirSync(join(repoRoot, "apps", "web"), { recursive: true });

    writeFileSync(
      join(repoRoot, ".wt", "settings.json"),
      JSON.stringify({ baseBranch: "main" }, null, 2)
    );
    writeFileSync(
      join(repoRoot, ".wt", "settings.local.json"),
      JSON.stringify({ baseBranch: "develop" }, null, 2)
    );
    writeFileSync(join(repoRoot, "apps", "web", "tracked.json"), '{"tracked":true}\n');
    writeFileSync(join(repoRoot, "apps", "web", ".env.local"), "APP=1\n");

    await $`git -C ${repoRoot} init -q`;
    await $`git -C ${repoRoot} add .wt/settings.json apps/web/tracked.json`.quiet();

    await copyConfiguredPaths(
      {
        copy: {
          include: [".wt", "apps"],
          exclude: [],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(existsSync(join(worktreePath, ".wt", "settings.json"))).toBeFalse();
    expect(
      readFileSync(join(worktreePath, ".wt", "settings.local.json"), "utf-8")
    ).toContain('"develop"');
    expect(existsSync(join(worktreePath, "apps", "web", "tracked.json"))).toBeFalse();
    expect(readFileSync(join(worktreePath, "apps", "web", ".env.local"), "utf-8")).toBe(
      "APP=1\n"
    );
  });

  test("treats folder-only include and exclude patterns as subtree rules", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, ".wt"), { recursive: true });
    mkdirSync(join(repoRoot, "apps", "web"), { recursive: true });
    mkdirSync(join(repoRoot, "secrets"), { recursive: true });

    writeFileSync(
      join(repoRoot, ".wt", "settings.local.json"),
      JSON.stringify({ token: "local" }, null, 2)
    );
    writeFileSync(join(repoRoot, "apps", "web", ".env.local"), "APP=1\n");
    writeFileSync(join(repoRoot, "secrets", "token.txt"), "secret\n");

    await $`git -C ${repoRoot} init -q`;

    await copyConfiguredPaths(
      {
        copy: {
          include: [".wt", "apps", "secrets"],
          exclude: ["secrets"],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(
      readFileSync(join(worktreePath, ".wt", "settings.local.json"), "utf-8")
    ).toContain('"token": "local"');
    expect(readFileSync(join(worktreePath, "apps", "web", ".env.local"), "utf-8")).toBe(
      "APP=1\n"
    );
    expect(existsSync(join(worktreePath, "secrets"))).toBeFalse();
  });

  test("copies requested files while skipping excluded and gitignored directories", async () => {
    const repoRoot = makeTempDir("wt-copy-repo-");
    const worktreePath = makeTempDir("wt-copy-worktree-");

    mkdirSync(join(repoRoot, ".wt"), { recursive: true });
    mkdirSync(join(repoRoot, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(repoRoot, "cache"), { recursive: true });
    mkdirSync(join(repoRoot, "secrets"), { recursive: true });
    mkdirSync(join(repoRoot, "apps", "web"), { recursive: true });
    mkdirSync(join(repoRoot, "vendor", "lib"), { recursive: true });

    writeFileSync(join(repoRoot, ".gitignore"), "node_modules/\ncache/\n");
    writeFileSync(join(repoRoot, ".env"), "TOKEN=repo\n");
    writeFileSync(
      join(repoRoot, ".wt", "settings.local.json"),
      JSON.stringify({ token: "local" }, null, 2)
    );
    writeFileSync(join(repoRoot, ".wt", ".gitignore"), "settings.local.json\n");
    writeFileSync(join(repoRoot, ".wt", "meta.json"), '{"bad":true}\n');
    writeFileSync(join(repoRoot, "node_modules", "pkg", "index.js"), "module\n");
    writeFileSync(join(repoRoot, "cache", "data.txt"), "cached\n");
    writeFileSync(join(repoRoot, "secrets", "token.txt"), "secret\n");
    writeFileSync(join(repoRoot, "apps", "web", ".env.local"), "APP=1\n");
    writeFileSync(join(repoRoot, "vendor", "lib", ".git"), "gitdir: ../.git/modules/lib\n");

    await $`git -C ${repoRoot} init -q`;

    await copyConfiguredPaths(
      {
        copy: {
          include: [".env", ".wt", "apps/**", "secrets/**", "**/*"],
          exclude: ["secrets/**"],
        },
      },
      repoRoot,
      worktreePath
    );

    expect(readFileSync(join(worktreePath, ".env"), "utf-8")).toBe("TOKEN=repo\n");
    expect(
      readFileSync(join(worktreePath, ".wt", "settings.local.json"), "utf-8")
    ).toContain('"token": "local"');
    expect(readFileSync(join(worktreePath, "apps", "web", ".env.local"), "utf-8")).toBe(
      "APP=1\n"
    );
    expect(existsSync(join(worktreePath, ".wt", ".gitignore"))).toBeFalse();
    expect(existsSync(join(worktreePath, ".wt", "meta.json"))).toBeFalse();
    expect(existsSync(join(worktreePath, "node_modules"))).toBeFalse();
    expect(existsSync(join(worktreePath, "cache"))).toBeFalse();
    expect(existsSync(join(worktreePath, "vendor", "lib", ".git"))).toBeFalse();
    expect(existsSync(join(worktreePath, "secrets", "token.txt"))).toBeFalse();
  });
});
