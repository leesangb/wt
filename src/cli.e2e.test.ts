import { spawnSync } from "child_process";
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { basename, join } from "path";
import { fileURLToPath } from "url";
import { $ } from "bun";

interface TestRepo {
  originDir: string;
  repoName: string;
  repoRoot: string;
  worktreeRoot: string;
}

interface ShellSessionResult {
  processStatus: number | null;
  stdout: string;
  stderr: string;
}

const tempDirs: string[] = [];
const cliEntry = fileURLToPath(new URL("./index.ts", import.meta.url));
const bashWrapperTemplatePath = fileURLToPath(new URL("../shell/wt.bash", import.meta.url));

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function isShellAvailable(shell: string): boolean {
  return spawnSync("sh", ["-lc", `command -v ${shell}`], {
    stdio: "ignore",
  }).status === 0;
}

function readOutputValue(stdout: string, key: string): string {
  const line = stdout.split(/\r?\n/).find(entry => entry.startsWith(`${key}=`));

  if (!line) {
    throw new Error(`Missing ${key} in shell output:\n${stdout}`);
  }

  return line.slice(key.length + 1);
}

function assertProcessSuccess(status: number | null, stderr: string, stdout?: string): void {
  if (status !== 0) {
    throw new Error(
      `Process exited with ${status}\nstdout:\n${stdout ?? ""}\nstderr:\n${stderr}`
    );
  }
}

function runCli(args: string[], cwd: string): void {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf-8",
    env: process.env,
  });

  assertProcessSuccess(result.status, result.stderr, result.stdout);
}

async function createTestRepo(): Promise<TestRepo> {
  const originDir = makeTempDir("wt-origin-");
  const repoRoot = makeTempDir("wt-repo-");
  const worktreeRoot = makeTempDir("wt-worktrees-");
  const repoName = basename(originDir).replace(/\.git$/, "");

  await $`git init --bare ${originDir}`.quiet();
  await $`git clone ${originDir} ${repoRoot}`.quiet();
  await $`git -C ${repoRoot} config user.email test@example.com`.quiet();
  await $`git -C ${repoRoot} config user.name tester`.quiet();
  await $`git -C ${repoRoot} checkout -b main`.quiet();
  writeFileSync(join(repoRoot, "README.md"), "base\n");
  await $`git -C ${repoRoot} add README.md`.quiet();
  await $`git -C ${repoRoot} commit -m base`.quiet();
  await $`git -C ${repoRoot} push -u origin main`.quiet();
  await $`git -C ${repoRoot} remote set-head origin main`.quiet();

  runCli(["init"], repoRoot);

  const settingsPath = join(repoRoot, ".wt", "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  settings.worktreeDir = worktreeRoot;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return {
    originDir,
    repoName,
    repoRoot,
    worktreeRoot,
  };
}

function getWorktreePath(repo: TestRepo, worktreeId: string): string {
  return join(repo.worktreeRoot, `${repo.repoName}-${worktreeId}`);
}

function updateSettings(
  repoRoot: string,
  update: (settings: Record<string, any>) => void
): void {
  const settingsPath = join(repoRoot, ".wt", "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  update(settings);
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
}

function createCliRunner(tempDir: string): string {
  const cliPath = join(tempDir, "wt-cli");
  writeFileSync(
    cliPath,
    [
      "#!/bin/sh",
      `exec "${process.execPath}" "${cliEntry}" "$@"`,
      "",
    ].join("\n"),
    { mode: 0o755 }
  );
  return cliPath;
}

function createBashWrapper(tempDir: string, cliPath: string): string {
  const wrapperPath = join(tempDir, "wt.bash");
  const wrapperTemplate = readFileSync(bashWrapperTemplatePath, "utf-8");

  writeFileSync(
    wrapperPath,
    wrapperTemplate.replaceAll("/path/to/wt", cliPath),
    "utf-8"
  );

  return wrapperPath;
}

function runWrappedBashSession(
  repoRoot: string,
  commands: string[]
): ShellSessionResult {
  const tempDir = makeTempDir("wt-cli-e2e-");
  const cliPath = createCliRunner(tempDir);
  const wrapperPath = createBashWrapper(tempDir, cliPath);
  const command = [
    "shopt -s expand_aliases",
    'alias cd="echo alias-hit"',
    'source "$WRAPPER_PATH"',
    'builtin cd "$REPO_ROOT"',
    ...commands,
  ].join("\n");

  const result = spawnSync("bash", ["-lc", command], {
    encoding: "utf-8",
    env: {
      ...process.env,
      REPO_ROOT: repoRoot,
      WRAPPER_PATH: wrapperPath,
    },
  });

  return {
    processStatus: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function readLines(path: string): string[] {
  return readFileSync(path, "utf-8").trimEnd().split(/\r?\n/);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cli e2e", () => {
  test(
    "creates a worktree, pushes it to a local remote, and navigates via the bash wrapper",
    async () => {
      if (!isShellAvailable("bash")) {
        return;
      }

      const repo = await createTestRepo();
      const worktreeId = "test1234";
      const branchName = "feature-e2e";
      const worktreePath = getWorktreePath(repo, worktreeId);
      const result = runWrappedBashSession(repo.repoRoot, [
        `wt new ${branchName} --id ${worktreeId}`,
        "new_status=$?",
        'new_pwd="$PWD"',
        'builtin cd "$REPO_ROOT"',
        `wt cd ${worktreeId}`,
        "cd_status=$?",
        'cd_pwd="$PWD"',
        'printf \'NEW_STATUS=%s\\nNEW_PWD=%s\\nCD_STATUS=%s\\nCD_PWD=%s\\n\' "$new_status" "$new_pwd" "$cd_status" "$cd_pwd"',
      ]);
      const resolvedWorktreePath = realpathSync(worktreePath);
      const upstreamResult = spawnSync(
        "git",
        [
          "-C",
          worktreePath,
          "rev-parse",
          "--abbrev-ref",
          "--symbolic-full-name",
          "@{u}",
        ],
        {
          encoding: "utf-8",
        }
      );
      const remoteBranchResult = spawnSync(
        "git",
        [
          "--git-dir",
          repo.originDir,
          "show-ref",
          "--verify",
          "--quiet",
          "refs/heads/feature-e2e",
        ],
        {
          encoding: "utf-8",
        }
      );

      assertProcessSuccess(result.processStatus, result.stderr, result.stdout);
      assertProcessSuccess(
        upstreamResult.status,
        upstreamResult.stderr,
        upstreamResult.stdout
      );

      const newStatus = Number(readOutputValue(result.stdout, "NEW_STATUS"));
      const newPwd = readOutputValue(result.stdout, "NEW_PWD");
      const cdStatus = Number(readOutputValue(result.stdout, "CD_STATUS"));
      const cdPwd = readOutputValue(result.stdout, "CD_PWD");
      const resolvedNewPwd = realpathSync(newPwd);
      const resolvedCdPwd = realpathSync(cdPwd);

      expect(newStatus).toBe(0);
      expect(resolvedNewPwd).toBe(resolvedWorktreePath);
      expect(cdStatus).toBe(0);
      expect(resolvedCdPwd).toBe(resolvedWorktreePath);
      expect(existsSync(worktreePath)).toBeTrue();
      expect(existsSync(join(worktreePath, ".wt", "meta.json"))).toBeTrue();
      expect(remoteBranchResult.status).toBe(0);
      expect(upstreamResult.stdout.trim()).toBe("origin/feature-e2e");
    }
  );

  test("navigates to a worktree by branch name via the bash wrapper", async () => {
    if (!isShellAvailable("bash")) {
      return;
    }

    const repo = await createTestRepo();
    const worktreeId = "branch123";
    const branchName = "feature-branch-cd";
    const worktreePath = getWorktreePath(repo, worktreeId);

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);

    const result = runWrappedBashSession(repo.repoRoot, [
      `wt cd ${branchName}`,
      "cd_status=$?",
      'cd_pwd="$PWD"',
      'printf \'CD_STATUS=%s\\nCD_PWD=%s\\n\' "$cd_status" "$cd_pwd"',
    ]);

    assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

    const cdStatus = Number(readOutputValue(result.stdout, "CD_STATUS"));
    const cdPwd = readOutputValue(result.stdout, "CD_PWD");

    expect(cdStatus).toBe(0);
    expect(realpathSync(cdPwd)).toBe(realpathSync(worktreePath));
  });

  test("runs pre and post scripts in sync mode with the expected environment", async () => {
    if (!isShellAvailable("bash")) {
      return;
    }

    const repo = await createTestRepo();
    const worktreeId = "script123";
    const branchName = "feature-script-hooks";
    const worktreePath = getWorktreePath(repo, worktreeId);
    const preEnvPath = join(repo.repoRoot, ".wt", "pre-env.txt");
    const postEnvPath = join(worktreePath, ".wt", "post-env.txt");

    updateSettings(repo.repoRoot, settings => {
      settings.scripts = {
        pre: [
          `printf '%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n' "$PWD" "$WT_PATH" "$WT_ID" "$WT_FULL_ID" "$WT_BRANCH" "$WT_REPO_ROOT" "\${WT_SHELL_CD_FILE:-missing}" > .wt/pre-env.txt`,
        ],
        post: [
          `printf '%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n%s\\n' "$PWD" "$WT_PATH" "$WT_ID" "$WT_FULL_ID" "$WT_BRANCH" "$WT_REPO_ROOT" "\${WT_SHELL_CD_FILE:-missing}" > .wt/post-env.txt`,
        ],
        postMode: "sync",
      };
    });

    const result = runWrappedBashSession(repo.repoRoot, [
      `wt new ${branchName} --id ${worktreeId}`,
      "new_status=$?",
      'new_pwd="$PWD"',
      'printf \'NEW_STATUS=%s\\nNEW_PWD=%s\\n\' "$new_status" "$new_pwd"',
    ]);

    assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

    const newStatus = Number(readOutputValue(result.stdout, "NEW_STATUS"));
    const newPwd = readOutputValue(result.stdout, "NEW_PWD");
    const preLines = readLines(preEnvPath);
    const postLines = readLines(postEnvPath);
    const expectedFullId = `${repo.repoName}-${worktreeId}`;
    const resolvedRepoRoot = realpathSync(repo.repoRoot);
    const resolvedWorktreePath = realpathSync(worktreePath);

    expect(newStatus).toBe(0);
    expect(realpathSync(newPwd)).toBe(resolvedWorktreePath);

    expect(realpathSync(preLines[0])).toBe(resolvedRepoRoot);
    expect(realpathSync(preLines[1])).toBe(resolvedWorktreePath);
    expect(preLines[2]).toBe(worktreeId);
    expect(preLines[3]).toBe(expectedFullId);
    expect(preLines[4]).toBe(branchName);
    expect(realpathSync(preLines[5])).toBe(resolvedRepoRoot);
    expect(preLines[6]).toBe("missing");

    expect(realpathSync(postLines[0])).toBe(resolvedWorktreePath);
    expect(realpathSync(postLines[1])).toBe(resolvedWorktreePath);
    expect(postLines[2]).toBe(worktreeId);
    expect(postLines[3]).toBe(expectedFullId);
    expect(postLines[4]).toBe(branchName);
    expect(realpathSync(postLines[5])).toBe(resolvedRepoRoot);
    expect(postLines[6]).toBe("missing");
  });
});
