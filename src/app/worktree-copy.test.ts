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
  test("does not overwrite files tracked in the target worktree branch", async () => {
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
    await $`git -C ${repoRoot} worktree add ${worktreePath} main`.quiet();

    await copyConfiguredPaths(
      {
        copy: {
          include: ["config"],
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
