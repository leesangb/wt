import { spawnSync } from "child_process";
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
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

interface CliRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface CliRunOptions {
  input?: string;
  env?: Record<string, string | undefined>;
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

function findCommandPath(command: string): string {
  const result = spawnSync("sh", ["-lc", `command -v ${command}`], {
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    throw new Error(`Failed to find command: ${command}`);
  }

  return result.stdout.trim();
}

function readOutputValue(stdout: string, key: string): string {
  const line = stdout.split(/\r?\n/).find(entry => entry.startsWith(`${key}=`));

  if (!line) {
    throw new Error(`Missing ${key} in shell output:\n${stdout}`);
  }

  return line.slice(key.length + 1);
}

function readCliValue(stdout: string, key: string): string {
  const line = stdout.split(/\r?\n/).find(entry => entry.startsWith(`  ${key}: `));

  if (!line) {
    throw new Error(`Missing ${key} in CLI output:\n${stdout}`);
  }

  return line.slice(key.length + 4);
}

function assertProcessSuccess(status: number | null, stderr: string, stdout?: string): void {
  if (status !== 0) {
    throw new Error(
      `Process exited with ${status}\nstdout:\n${stdout ?? ""}\nstderr:\n${stderr}`
    );
  }
}

function runCliCapture(
  args: string[],
  cwd: string,
  options: CliRunOptions = {}
): CliRunResult {
  const result = spawnSync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf-8",
    env: {
      ...process.env,
      ...options.env,
    },
    input: options.input,
  });

  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function runCli(args: string[], cwd: string): void {
  const result = runCliCapture(args, cwd);
  assertProcessSuccess(result.status, result.stderr, result.stdout);
}

async function publishTestPullRequest(
  repo: TestRepo,
  pullRequestNumber: string,
  content: string
): Promise<void> {
  const sourceBranch = `wt-test-pr-${pullRequestNumber}`;
  const prFilePath = join(repo.repoRoot, "PULL_REQUEST.txt");

  await $`git -C ${repo.repoRoot} checkout -B ${sourceBranch} main`.quiet();
  writeFileSync(prFilePath, `${content}\n`);
  await $`git -C ${repo.repoRoot} add PULL_REQUEST.txt`.quiet();
  await $`git -C ${repo.repoRoot} commit -m ${`pr-${pullRequestNumber}-${content}`}`.quiet();
  await $`git -C ${repo.repoRoot} push --force origin HEAD:refs/wt-test/pr/${pullRequestNumber}`.quiet();
  await $`git -C ${repo.repoRoot} checkout main`.quiet();
  await $`git -C ${repo.repoRoot} branch -D ${sourceBranch}`.quiet();
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
  return join(
    repo.worktreeRoot,
    `${repo.repoName}-${worktreeId.replaceAll("/", "-")}`
  );
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

function createFakeGithubCli(tempDir: string): string {
  const ghPath = join(tempDir, "gh");

  writeFileSync(
    ghPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "--version" ]; then',
      '  echo "gh version 99.0.0-test"',
      "  exit 0",
      "fi",
      'if [ "$1" = "auth" ] && [ "$2" = "status" ]; then',
      '  if [ "${WT_TEST_GH_AUTH_STATUS:-0}" != "0" ]; then',
      '    echo "not logged in" >&2',
      "    exit 1",
      "  fi",
      "  exit 0",
      "fi",
      'if [ "$1" = "pr" ] && [ "$2" = "checkout" ]; then',
      '  number="$3"',
      "  shift 3",
      '  branch=""',
      '  force="0"',
      '  while [ "$#" -gt 0 ]; do',
      '    case "$1" in',
      '      -b|--branch)',
      '        branch="$2"',
      "        shift 2",
      "        ;;",
      '      -f|--force)',
      '        force="1"',
      "        shift 1",
      "        ;;",
      '      --detach|--recurse-submodules)',
      "        shift 1",
      "        ;;",
      "      *)",
      "        shift 1",
      "        ;;",
      "    esac",
      "  done",
      '  if [ -z "$branch" ]; then',
      '    branch="pr-$number"',
      "  fi",
      '  git fetch -q origin "refs/wt-test/pr/$number" || exit 1',
      '  if git show-ref --verify --quiet "refs/heads/$branch"; then',
      '    git checkout -q "$branch" || exit 1',
      '    if [ "$force" = "1" ]; then',
      '      git reset --hard -q FETCH_HEAD || exit 1',
      "    fi",
      "  else",
      '    git checkout -q -B "$branch" FETCH_HEAD || exit 1',
      "  fi",
      "  exit 0",
      "fi",
      'echo "unsupported gh command" >&2',
      "exit 1",
      "",
    ].join("\n"),
    { mode: 0o755 }
  );

  return ghPath;
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
  commands: string[],
  env: Record<string, string | undefined> = {}
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
      ...env,
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

  test("creates a pull request worktree and navigates via the bash wrapper", async () => {
    if (!isShellAvailable("bash")) {
      return;
    }

    const repo = await createTestRepo();
    const fakeBinDir = makeTempDir("wt-fake-gh-");
    const worktreePath = getWorktreePath(repo, "pr-123");
    const fakePath = `${fakeBinDir}:${process.env.PATH ?? ""}`;

    createFakeGithubCli(fakeBinDir);
    await publishTestPullRequest(repo, "123", "pr content v1");

    const result = runWrappedBashSession(
      repo.repoRoot,
      [
        `export PATH="${fakePath}"`,
        "wt pr 123",
        "pr_status=$?",
        'pr_pwd="$PWD"',
        'printf \'PR_STATUS=%s\\nPR_PWD=%s\\n\' "$pr_status" "$pr_pwd"',
      ]
    );
    const branchResult = spawnSync(
      "git",
      ["-C", worktreePath, "rev-parse", "--abbrev-ref", "HEAD"],
      {
        encoding: "utf-8",
      }
    );

    assertProcessSuccess(result.processStatus, result.stderr, result.stdout);
    assertProcessSuccess(
      branchResult.status,
      branchResult.stderr,
      branchResult.stdout
    );

    const prStatus = Number(readOutputValue(result.stdout, "PR_STATUS"));
    const prPwd = readOutputValue(result.stdout, "PR_PWD");

    expect(prStatus).toBe(0);
    expect(realpathSync(prPwd)).toBe(realpathSync(worktreePath));
    expect(branchResult.stdout.trim()).toBe("pr-123");
    expect(readFileSync(join(worktreePath, "PULL_REQUEST.txt"), "utf-8")).toBe(
      "pr content v1\n"
    );
  });

  test("refreshes an existing pull request worktree when rerun", async () => {
    const repo = await createTestRepo();
    const fakeBinDir = makeTempDir("wt-fake-gh-");
    const worktreePath = getWorktreePath(repo, "pr-123");

    createFakeGithubCli(fakeBinDir);
    await publishTestPullRequest(repo, "123", "pr content v1");

    const firstResult = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    assertProcessSuccess(firstResult.status, firstResult.stderr, firstResult.stdout);
    expect(readFileSync(join(worktreePath, "PULL_REQUEST.txt"), "utf-8")).toBe(
      "pr content v1\n"
    );

    await publishTestPullRequest(repo, "123", "pr content v2");

    const secondResult = runCliCapture(
      ["pr", "123", "--no-cd"],
      repo.repoRoot,
      {
        env: {
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        },
      }
    );

    assertProcessSuccess(
      secondResult.status,
      secondResult.stderr,
      secondResult.stdout
    );
    expect(secondResult.stdout).toContain("✓ Refreshed PR worktree: #123");
    expect(readFileSync(join(worktreePath, "PULL_REQUEST.txt"), "utf-8")).toBe(
      "pr content v2\n"
    );
  });

  test("shows an actionable error when GitHub CLI is missing", async () => {
    const repo = await createTestRepo();
    const fakeBinDir = makeTempDir("wt-git-only-");
    const gitPath = findCommandPath("git");

    symlinkSync(gitPath, join(fakeBinDir, "git"));

    const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: {
        PATH: fakeBinDir,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Error: GitHub CLI (`gh`) is required for `wt pr`."
    );
    expect(result.stderr).toContain("https://cli.github.com/");
  });

  test("shows an actionable error when GitHub CLI is not authenticated", async () => {
    const repo = await createTestRepo();
    const fakeBinDir = makeTempDir("wt-fake-gh-");

    createFakeGithubCli(fakeBinDir);

    const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
        WT_TEST_GH_AUTH_STATUS: "1",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Error: GitHub CLI is not authenticated."
    );
    expect(result.stderr).toContain("gh auth login");
  });

  test("refuses to reuse the main worktree when it is already on the PR branch", async () => {
    const repo = await createTestRepo();
    const fakeBinDir = makeTempDir("wt-fake-gh-");
    const worktreePath = getWorktreePath(repo, "pr-123");

    createFakeGithubCli(fakeBinDir);
    await publishTestPullRequest(repo, "123", "pr content v1");
    await $`git -C ${repo.repoRoot} checkout -B pr-123 main`.quiet();

    const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: {
        PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "The main worktree is already using branch pr-123."
    );
    expect(existsSync(worktreePath)).toBeFalse();
    expect(existsSync(join(repo.repoRoot, ".wt", "meta.json"))).toBeFalse();
  });

  test("keeps slash-based ids while sanitizing the worktree directory name", async () => {
    const repo = await createTestRepo();
    const branchName = "feature/issue-12";
    const worktreePath = getWorktreePath(repo, branchName);

    const createResult = runCliCapture(["new", branchName, "--no-cd"], repo.repoRoot);
    assertProcessSuccess(
      createResult.status,
      createResult.stderr,
      createResult.stdout
    );

    const listResult = runCliCapture(["list"], repo.repoRoot);
    assertProcessSuccess(listResult.status, listResult.stderr, listResult.stdout);

    expect(existsSync(worktreePath)).toBeTrue();
    expect(createResult.stdout).toContain(`WT_ID: ${branchName}`);
    expect(createResult.stdout).toContain(`WT_PATH: ${worktreePath}`);
    expect(listResult.stdout).toContain(`ID:      ${branchName}`);

    const removeResult = runCliCapture(
      ["remove", branchName, "--keep-branch"],
      repo.repoRoot
    );
    assertProcessSuccess(
      removeResult.status,
      removeResult.stderr,
      removeResult.stdout
    );

    expect(removeResult.stdout).toContain(`(${branchName})`);
    expect(existsSync(worktreePath)).toBeFalse();
  });

  test("shows the main worktree in completion by default and hides it when requested", async () => {
    const repo = await createTestRepo();
    const worktreeId = "completion123";
    const branchName = "feature-completion";

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);

    const defaultCompletionResult = runCliCapture(
      ["list", "--completion", "bash"],
      repo.repoRoot
    );
    assertProcessSuccess(
      defaultCompletionResult.status,
      defaultCompletionResult.stderr,
      defaultCompletionResult.stdout
    );

    const hiddenMainCompletionWithFlagResult = runCliCapture(
      ["list", "--completion", "bash", "--exclude-main-worktree"],
      repo.repoRoot
    );
    assertProcessSuccess(
      hiddenMainCompletionWithFlagResult.status,
      hiddenMainCompletionWithFlagResult.stderr,
      hiddenMainCompletionWithFlagResult.stdout
    );

    const defaultSuggestions = defaultCompletionResult.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    const hiddenMainSuggestions = hiddenMainCompletionWithFlagResult.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    expect(
      defaultSuggestions.some(line => line.startsWith(`${basename(repo.repoRoot)}:`))
    ).toBeTrue();
    expect(
      defaultSuggestions.some(line => line.startsWith(`${worktreeId}:`))
    ).toBeTrue();
    expect(
      hiddenMainSuggestions.some(line => line.startsWith(`${worktreeId}:`))
    ).toBeTrue();
    expect(
      hiddenMainSuggestions.some(line => line.startsWith(`${basename(repo.repoRoot)}:`))
    ).toBeFalse();
  });

  test("hides the main worktree from completion even inside a linked worktree", async () => {
    const repo = await createTestRepo();
    const worktreeId = "linked123";
    const branchName = "feature-linked";
    const worktreePath = getWorktreePath(repo, worktreeId);

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);

    const completionResult = runCliCapture(
      ["list", "--completion", "bash", "--exclude-main-worktree"],
      worktreePath
    );
    assertProcessSuccess(
      completionResult.status,
      completionResult.stderr,
      completionResult.stdout
    );

    const suggestions = completionResult.stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    expect(
      suggestions.some(line => line.startsWith(`${worktreeId}:`))
    ).toBeTrue();
    expect(
      suggestions.some(line => line.startsWith(`${basename(repo.repoRoot)}:`))
    ).toBeFalse();
  });

  test("asks for confirmation before removing a worktree with local changes", async () => {
    const repo = await createTestRepo();
    const worktreeId = "confirm123";
    const branchName = "feature-confirm";
    const worktreePath = getWorktreePath(repo, worktreeId);

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
    writeFileSync(join(worktreePath, "UNTRACKED.md"), "dirty\n");

    const cancelResult = runCliCapture(["remove", worktreeId], repo.repoRoot, {
      input: "n\n",
    });

    expect(cancelResult.status).toBe(1);
    expect(cancelResult.stdout).toContain("1 local change");
    expect(cancelResult.stdout).toContain("Remove this worktree anyway? [y/N]");
    expect(cancelResult.stderr).toContain("Error: Removal cancelled");
    expect(existsSync(worktreePath)).toBeTrue();

    const confirmResult = runCliCapture(["remove", worktreeId], repo.repoRoot, {
      input: "y\n",
    });

    assertProcessSuccess(
      confirmResult.status,
      confirmResult.stderr,
      confirmResult.stdout
    );
    expect(confirmResult.stdout).toContain("Warning:");
    expect(existsSync(worktreePath)).toBeFalse();
  });

  test("asks for confirmation before removing a worktree with local-only commits", async () => {
    const repo = await createTestRepo();
    const worktreeId = "noremote123";
    const branchName = "feature-no-remote";
    const worktreePath = getWorktreePath(repo, worktreeId);

    runCli(
      ["new", branchName, "--id", worktreeId, "--no-push", "--no-cd"],
      repo.repoRoot
    );
    writeFileSync(join(worktreePath, "README.md"), "base\nlocal commit\n");
    await $`git -C ${worktreePath} add README.md`.quiet();
    await $`git -C ${worktreePath} commit -m local`.quiet();

    const cancelResult = runCliCapture(["remove", worktreeId], repo.repoRoot, {
      input: "n\n",
    });

    expect(cancelResult.status).toBe(1);
    expect(cancelResult.stdout).toContain(
      "1 local commit not on the base or upstream branch"
    );
    expect(cancelResult.stderr).toContain("Error: Removal cancelled");
    expect(existsSync(worktreePath)).toBeTrue();

    const confirmResult = runCliCapture(["remove", worktreeId], repo.repoRoot, {
      input: "y\n",
    });

    assertProcessSuccess(
      confirmResult.status,
      confirmResult.stderr,
      confirmResult.stdout
    );
    expect(existsSync(worktreePath)).toBeFalse();
  });

  test("allows force removal without confirmation", async () => {
    const repo = await createTestRepo();
    const worktreeId = "force123";
    const branchName = "feature-force";
    const worktreePath = getWorktreePath(repo, worktreeId);

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
    writeFileSync(join(worktreePath, "README.md"), "dirty\n");

    const result = runCliCapture(
      ["remove", worktreeId, "--force"],
      repo.repoRoot
    );

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    expect(result.stdout).not.toContain("Remove this worktree anyway? [y/N]");
    expect(existsSync(worktreePath)).toBeFalse();
  });

  test("adds a unique suffix when sanitized ids would collide", async () => {
    const repo = await createTestRepo();
    const firstBranch = "feature/foo";
    const secondBranch = "feature-foo";

    const firstResult = runCliCapture(["new", firstBranch, "--no-cd"], repo.repoRoot);
    assertProcessSuccess(firstResult.status, firstResult.stderr, firstResult.stdout);

    const secondResult = runCliCapture(
      ["new", secondBranch, "--no-cd"],
      repo.repoRoot
    );
    assertProcessSuccess(
      secondResult.status,
      secondResult.stderr,
      secondResult.stdout
    );

    const firstPath = readCliValue(firstResult.stdout, "WT_PATH");
    const secondPath = readCliValue(secondResult.stdout, "WT_PATH");

    expect(firstPath).not.toBe(secondPath);
    expect(secondPath).toContain(`${repo.repoName}-feature-foo-`);
    expect(existsSync(firstPath)).toBeTrue();
    expect(existsSync(secondPath)).toBeTrue();
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

  test("resolves relative worktreeDir from repo root even when invoked in a subdirectory", async () => {
    const repo = await createTestRepo();
    const worktreeId = "relative1";
    const branchName = "feature-relative-dir";
    const nestedDir = join(repo.repoRoot, "packages", "app");
    const expectedWorktreeRoot = join(repo.repoRoot, "worktrees");
    const expectedWorktreePath = join(
      expectedWorktreeRoot,
      `${repo.repoName}-${worktreeId}`
    );

    updateSettings(repo.repoRoot, settings => {
      settings.worktreeDir = "./worktrees";
    });

    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, ".gitkeep"), "");

    const result = runCliCapture(
      ["new", branchName, "--id", worktreeId, "--no-cd"],
      nestedDir
    );

    assertProcessSuccess(result.status, result.stderr, result.stdout);

    const resolvedWorktreePath = realpathSync(expectedWorktreePath);

    expect(existsSync(expectedWorktreePath)).toBeTrue();
    expect(existsSync(join(expectedWorktreePath, ".wt", "meta.json"))).toBeTrue();
    expect(result.stdout).toContain(`WT_PATH: ${resolvedWorktreePath}`);
    expect(result.stdout).toContain(`cd ${resolvedWorktreePath}`);
  });
});
