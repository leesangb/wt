import { spawnSync } from "child_process";
import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
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

interface CliRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface CliRunOptions {
  input?: string;
  env?: Record<string, string | undefined>;
}

interface FakeGithubCliOptions {
  authenticated?: boolean;
  available?: boolean;
  baseBranch?: string;
  checkoutCreatesBranchBeforeFail?: boolean;
  checkoutFailureMessage?: string;
  checkoutRef?: string;
  headBranch?: string;
  headRefOid?: string;
  logPath?: string;
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

function createFakeGithubEnv(
  options: FakeGithubCliOptions = {}
): Record<string, string> {
  const tempDir = makeTempDir("wt-gh-");
  const binDir = join(tempDir, "bin");
  const ghPath = join(binDir, "gh");
  const baseBranch = options.baseBranch ?? "main";
  const checkoutCreatesBranchBeforeFail =
    options.checkoutCreatesBranchBeforeFail === true;
  const checkoutFailureMessage = options.checkoutFailureMessage ?? "";
  const checkoutRef = options.checkoutRef ?? "";
  const headBranch = options.headBranch ?? "feature/pr-123";
  const headRefOid =
    options.headRefOid ?? "0000000000000000000000000000000000000000";

  mkdirSync(binDir, { recursive: true });

  if (options.available === false) {
    writeFileSync(
      ghPath,
      [
        "#!/bin/sh",
        'echo "gh: command not found" >&2',
        "exit 127",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );
  } else {
    const authScript =
      options.authenticated === false
        ? ['echo "not logged in" >&2', "exit 1"]
        : ["exit 0"];
    const logLine = options.logPath
      ? `printf '%s\\n' "$*" >> "${options.logPath}"`
      : ":";

    writeFileSync(
      ghPath,
      [
        "#!/bin/sh",
        "set -eu",
        logLine,
        'if [ "$1" = "--version" ]; then',
        '  printf \'%s\\n\' "gh version 9.9.9"',
        "  exit 0",
        "fi",
        'if [ "$1" = "auth" ] && [ "${2:-}" = "status" ]; then',
        ...authScript.map((line) => `  ${line}`),
        "fi",
        'if [ "$1" = "pr" ] && [ "${2:-}" = "view" ]; then',
        `  printf '%s\\n' '{"baseRefName":"${baseBranch}","headRefName":"${headBranch}","headRefOid":"${headRefOid}"}'`,
        "  exit 0",
        "fi",
        'if [ "$1" = "pr" ] && [ "${2:-}" = "checkout" ]; then',
        "  pr_number=$3",
        `  branch_name="${headBranch}"`,
        `  checkout_ref="${checkoutRef}"`,
        `  checkout_failure_message="${checkoutFailureMessage}"`,
        `  checkout_creates_branch_before_fail="${checkoutCreatesBranchBeforeFail ? "1" : "0"}"`,
        '  if [ -n "$checkout_failure_message" ]; then',
        '    if [ "$checkout_creates_branch_before_fail" = "1" ]; then',
        '      if [ -n "$checkout_ref" ]; then',
        '        git checkout -B "$branch_name" "$checkout_ref" >/dev/null 2>&1',
        "      else",
        '        git checkout -B "$branch_name" >/dev/null 2>&1',
        "      fi",
        "    fi",
        '    echo "$checkout_failure_message" >&2',
        "    exit 1",
        "  fi",
        '  if [ -n "$checkout_ref" ]; then',
        '    if git show-ref --verify --quiet "refs/heads/$branch_name"; then',
        '      if [ "$(git branch --show-current)" = "$branch_name" ]; then',
        '        echo "Already on \'$branch_name\'" >&2',
        "      fi",
        '      if ! git merge-base --is-ancestor "$branch_name" "$checkout_ref"; then',
        '        echo "hint: Diverging branches can\'t be fast-forwarded, you need to either:" >&2',
        '        echo "fatal: Not possible to fast-forward, aborting." >&2',
        "        exit 1",
        "      fi",
        '      git checkout "$branch_name" >/dev/null 2>&1',
        '      git merge --ff-only "$checkout_ref" >/dev/null 2>&1',
        "    else",
        '      git checkout -B "$branch_name" "$checkout_ref" >/dev/null 2>&1',
        "    fi",
        "    exit 0",
        "  fi",
        '  git checkout "$branch_name" >/dev/null 2>&1 || git checkout -B "$branch_name" >/dev/null 2>&1',
        `  printf 'pr %s\\n' "$pr_number" >> README.md`,
        "  git add README.md",
        "  if ! git diff --cached --quiet; then",
        `    git commit -m "checkout pr $pr_number" >/dev/null 2>&1`,
        "  fi",
        "  exit 0",
        "fi",
        'echo "unsupported gh args" >&2',
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );
  }

  return {
    PATH: `${binDir}:${process.env.PATH ?? ""}`,
  };
}

function runWrappedBashSession(
  repoRoot: string,
  commands: string[],
  envOverrides: Record<string, string | undefined> = {}
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

  const result = spawnSync("bash", ["-c", command], {
    encoding: "utf-8",
    env: {
      ...process.env,
      REPO_ROOT: repoRoot,
      WRAPPER_PATH: wrapperPath,
      ...envOverrides,
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

  test(
    "creates a pull request worktree with the PR head branch and navigates via the bash wrapper",
    async () => {
      if (!isShellAvailable("bash")) {
        return;
      }

      const repo = await createTestRepo();
      const headBranch = "feature/pr-123";
      const result = runWrappedBashSession(
        repo.repoRoot,
        [
          "wt pr 123",
          "pr_status=$?",
          'pr_pwd="$PWD"',
          'printf \'PR_STATUS=%s\\nPR_PWD=%s\\n\' "$pr_status" "$pr_pwd"',
        ],
        createFakeGithubEnv({ headBranch })
      );

      assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

      const prStatus = Number(readOutputValue(result.stdout, "PR_STATUS"));
      const prPwd = readOutputValue(result.stdout, "PR_PWD");

      if (prStatus !== 0) {
        throw new Error(
          `wt pr failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
        );
      }

      const worktreePath = readCliValue(result.stdout, "WT_PATH");
      const branchResult = spawnSync(
        "git",
        ["-C", worktreePath, "branch", "--show-current"],
        {
          encoding: "utf-8",
        }
      );

      assertProcessSuccess(
        branchResult.status,
        branchResult.stderr,
        branchResult.stdout
      );

      expect(prStatus).toBe(0);
      expect(realpathSync(prPwd)).toBe(realpathSync(worktreePath));
      expect(branchResult.stdout.trim()).toBe(headBranch);
      expect(readFileSync(join(worktreePath, "README.md"), "utf-8")).toContain(
        "pr 123"
      );
    }
  );

  test(
    "creates a pull request worktree when the PR head diverges from the current base branch",
    async () => {
      const repo = await createTestRepo();
      const headBranch = "feature/pr-123";
      const checkoutRef = `refs/wt/pr/${headBranch}`;

      await $`git -C ${repo.repoRoot} checkout -b ${headBranch}`.quiet();
      writeFileSync(join(repo.repoRoot, "README.md"), "base\npr branch\n");
      await $`git -C ${repo.repoRoot} add README.md`.quiet();
      await $`git -C ${repo.repoRoot} commit -m pr-source`.quiet();

      const prHeadCommit = (
        await $`git -C ${repo.repoRoot} rev-parse HEAD`.text()
      ).trim();

      await $`git -C ${repo.repoRoot} update-ref ${checkoutRef} ${prHeadCommit}`.quiet();
      await $`git -C ${repo.repoRoot} checkout main`.quiet();

      writeFileSync(join(repo.repoRoot, "README.md"), "base\nmain advance\n");
      await $`git -C ${repo.repoRoot} add README.md`.quiet();
      await $`git -C ${repo.repoRoot} commit -m main-advance`.quiet();
      await $`git -C ${repo.repoRoot} branch -D ${headBranch}`.quiet();

      const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
        env: createFakeGithubEnv({ headBranch, checkoutRef }),
      });

      assertProcessSuccess(result.status, result.stderr, result.stdout);

      const worktreePath = readCliValue(result.stdout, "WT_PATH");
      const branchResult = spawnSync(
        "git",
        ["-C", worktreePath, "branch", "--show-current"],
        {
          encoding: "utf-8",
        }
      );

      assertProcessSuccess(
        branchResult.status,
        branchResult.stderr,
        branchResult.stdout
      );

      expect(branchResult.stdout.trim()).toBe(headBranch);
      expect(readFileSync(join(worktreePath, "README.md"), "utf-8")).toContain(
        "pr branch"
      );
      expect(readFileSync(join(worktreePath, "README.md"), "utf-8")).not.toContain(
        "main advance"
      );
    }
  );

  test(
    "shows an actionable error when an existing local PR branch diverges without a matching worktree",
    async () => {
      const repo = await createTestRepo();
      const headBranch = "feature/pr-123";
      const checkoutRef = `refs/wt/pr/${headBranch}`;

      await $`git -C ${repo.repoRoot} checkout -b ${headBranch}`.quiet();
      writeFileSync(join(repo.repoRoot, "README.md"), "base\npr branch\n");
      await $`git -C ${repo.repoRoot} add README.md`.quiet();
      await $`git -C ${repo.repoRoot} commit -m pr-source`.quiet();

      const prHeadCommit = (
        await $`git -C ${repo.repoRoot} rev-parse HEAD`.text()
      ).trim();

      await $`git -C ${repo.repoRoot} update-ref ${checkoutRef} ${prHeadCommit}`.quiet();
      await $`git -C ${repo.repoRoot} checkout main`.quiet();

      writeFileSync(join(repo.repoRoot, "README.md"), "base\nlocal stale branch\n");
      await $`git -C ${repo.repoRoot} add README.md`.quiet();
      await $`git -C ${repo.repoRoot} commit -m local-stale-branch`.quiet();
      await $`git -C ${repo.repoRoot} branch -f ${headBranch} HEAD`.quiet();

      const worktreePath = getWorktreePath(repo, headBranch);
      const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
        env: createFakeGithubEnv({ headBranch, checkoutRef, headRefOid: prHeadCommit }),
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain(
        `Local branch ${headBranch} already exists but diverges from PR #123.`
      );
      expect(existsSync(worktreePath)).toBeFalse();

      const branchResult = spawnSync(
        "git",
        ["-C", repo.repoRoot, "branch", "--list", headBranch],
        {
          encoding: "utf-8",
        }
      );

      assertProcessSuccess(
        branchResult.status,
        branchResult.stderr,
        branchResult.stdout
      );

      expect(branchResult.stdout).toContain(headBranch);
    }
  );

  test("reuses an existing pull request worktree using the PR head branch", async () => {
    if (!isShellAvailable("bash")) {
      return;
    }

    const repo = await createTestRepo();
    const headBranch = "feature/pr-123";
    const createResult = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ headBranch }),
    });

    assertProcessSuccess(
      createResult.status,
      createResult.stderr,
      createResult.stdout
    );

    const worktreePath = readCliValue(createResult.stdout, "WT_PATH");
    const reuseResult = runWrappedBashSession(
      repo.repoRoot,
      [
        "wt pr 123",
        "pr_status=$?",
        'pr_pwd="$PWD"',
        'printf \'PR_STATUS=%s\\nPR_PWD=%s\\n\' "$pr_status" "$pr_pwd"',
      ],
      createFakeGithubEnv({ headBranch })
    );

    assertProcessSuccess(
      reuseResult.processStatus,
      reuseResult.stderr,
      reuseResult.stdout
    );

    expect(Number(readOutputValue(reuseResult.stdout, "PR_STATUS"))).toBe(0);
    expect(realpathSync(readOutputValue(reuseResult.stdout, "PR_PWD"))).toBe(
      realpathSync(worktreePath)
    );
    expect(reuseResult.stdout).toContain(
      `Using existing PR worktree: ${headBranch}`
    );
  });

  test("cleans up a temporary PR worktree when checkout fails", async () => {
    const repo = await createTestRepo();
    const headBranch = "feature/pr-123";
    const worktreePath = getWorktreePath(repo, headBranch);
    const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({
        headBranch,
        checkoutFailureMessage: "simulated gh checkout failure",
        checkoutCreatesBranchBeforeFail: true,
      }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("simulated gh checkout failure");
    expect(existsSync(worktreePath)).toBeFalse();

    const worktreeList = await $`git -C ${repo.repoRoot} worktree list --porcelain`.text();
    const branchResult = spawnSync(
      "git",
      ["-C", repo.repoRoot, "branch", "--list", headBranch],
      {
        encoding: "utf-8",
      }
    );

    assertProcessSuccess(
      branchResult.status,
      branchResult.stderr,
      branchResult.stdout
    );

    expect(worktreeList).not.toContain(worktreePath);
    expect(branchResult.stdout.trim()).toBe("");
  });

  test("reuses an existing PR head branch worktree even when its id differs", async () => {
    if (!isShellAvailable("bash")) {
      return;
    }

    const repo = await createTestRepo();
    const worktreeId = "review-pr-worktree";
    const worktreePath = getWorktreePath(repo, worktreeId);
    const headBranch = "feature/pr-123";

    runCli(["new", headBranch, "--id", worktreeId, "--no-cd"], repo.repoRoot);

    const result = runWrappedBashSession(
      repo.repoRoot,
      [
        "wt pr 123",
        "pr_status=$?",
        'pr_pwd="$PWD"',
        'printf \'PR_STATUS=%s\\nPR_PWD=%s\\n\' "$pr_status" "$pr_pwd"',
      ],
      createFakeGithubEnv({ headBranch })
    );

    assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

    expect(Number(readOutputValue(result.stdout, "PR_STATUS"))).toBe(0);
    expect(realpathSync(readOutputValue(result.stdout, "PR_PWD"))).toBe(
      realpathSync(worktreePath)
    );
    expect(result.stdout).toContain(`WT_ID: ${worktreeId}`);
  });

  test("does not pass force when checking out a pull request", async () => {
    const repo = await createTestRepo();
    const ghLogPath = join(makeTempDir("wt-gh-log-"), "gh.log");
    const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ logPath: ghLogPath }),
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);

    const ghLog = readFileSync(ghLogPath, "utf-8");

    expect(ghLog).toContain("pr checkout 123");
    expect(ghLog).not.toContain("--branch");
    expect(ghLog).not.toContain("--force");
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

  test("includes removal metadata in completion output", async () => {
    const repo = await createTestRepo();
    const worktreeId = "removemeta123";
    const branchName = "feature-remove-meta";
    const worktreePath = getWorktreePath(repo, worktreeId);

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
    writeFileSync(join(worktreePath, "README.md"), "base\nremove-metadata\n");
    await $`git -C ${worktreePath} add README.md`.quiet();
    await $`git -C ${worktreePath} commit -m completion-meta`.quiet();
    await $`git -C ${worktreePath} push origin ${branchName}`.quiet();

    const completionResult = runCliCapture(
      ["list", "--completion", "bash", "--exclude-main-worktree"],
      repo.repoRoot
    );
    assertProcessSuccess(
      completionResult.status,
      completionResult.stderr,
      completionResult.stdout
    );

    expect(completionResult.stdout).toContain(`${worktreeId}:${branchName} |`);
    expect(completionResult.stdout).toContain("not merged");
    expect(completionResult.stdout).toContain("from main@");
    expect(completionResult.stdout).not.toContain("change");
    expect(completionResult.stdout).not.toContain("unpushed");
  });

  test("omits merged status in completion output when merge status is unknown", async () => {
    const repo = await createTestRepo();
    const worktreeId = "removeunknown123";
    const branchName = "feature-remove-unknown";
    const worktreePath = getWorktreePath(repo, worktreeId);
    const metaPath = join(worktreePath, ".wt", "meta.json");

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);

    const meta = JSON.parse(readFileSync(metaPath, "utf-8"));
    meta.baseBranch = "missing-base";
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));

    const completionResult = runCliCapture(
      ["list", "--completion", "bash", "--exclude-main-worktree"],
      repo.repoRoot
    );
    assertProcessSuccess(
      completionResult.status,
      completionResult.stderr,
      completionResult.stdout
    );

    const completionLine = completionResult.stdout
      .split(/\r?\n/)
      .find(line => line.startsWith(`${worktreeId}:`));

    expect(completionLine).toBeDefined();
    expect(completionLine).toContain(`${branchName} | from missing-base`);
    expect(completionLine).not.toContain("not merged");
    expect(completionLine).not.toContain("merged |");
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

  test("removes multiple worktrees in one command", async () => {
    const repo = await createTestRepo();
    const firstWorktreeId = "multi123";
    const secondWorktreeId = "multi456";
    const firstBranchName = "feature-multi-one";
    const secondBranchName = "feature-multi-two";
    const firstWorktreePath = getWorktreePath(repo, firstWorktreeId);
    const secondWorktreePath = getWorktreePath(repo, secondWorktreeId);

    runCli(
      ["new", firstBranchName, "--id", firstWorktreeId, "--no-cd"],
      repo.repoRoot
    );
    runCli(
      ["new", secondBranchName, "--id", secondWorktreeId, "--no-cd"],
      repo.repoRoot
    );

    const result = runCliCapture(
      ["remove", firstWorktreeId, secondWorktreeId, "--keep-branch"],
      repo.repoRoot
    );

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    expect(result.stdout).toContain(`(${firstWorktreeId})`);
    expect(result.stdout).toContain(`(${secondWorktreeId})`);
    expect(existsSync(firstWorktreePath)).toBeFalse();
    expect(existsSync(secondWorktreePath)).toBeFalse();
  });

  test("asks for confirmation for each worktree during batch removal", async () => {
    const repo = await createTestRepo();
    const firstWorktreeId = "batchconfirm123";
    const secondWorktreeId = "batchconfirm456";
    const firstBranchName = "feature-batch-confirm-one";
    const secondBranchName = "feature-batch-confirm-two";
    const firstWorktreePath = getWorktreePath(repo, firstWorktreeId);
    const secondWorktreePath = getWorktreePath(repo, secondWorktreeId);

    runCli(
      ["new", firstBranchName, "--id", firstWorktreeId, "--no-cd"],
      repo.repoRoot
    );
    runCli(
      ["new", secondBranchName, "--id", secondWorktreeId, "--no-cd"],
      repo.repoRoot
    );
    writeFileSync(join(firstWorktreePath, "UNTRACKED.md"), "dirty one\n");
    writeFileSync(join(secondWorktreePath, "UNTRACKED.md"), "dirty two\n");

    const result = runCliCapture(
      ["remove", firstWorktreeId, secondWorktreeId],
      repo.repoRoot,
      {
        input: "n\ny\n",
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `Warning: ${firstBranchName} (${firstWorktreeId}) has 1 local change.`
    );
    expect(result.stdout).toContain(
      `Warning: ${secondBranchName} (${secondWorktreeId}) has 1 local change.`
    );
    expect(result.stdout).toContain(
      `Skipped worktree: ${firstBranchName} (${firstWorktreeId})`
    );
    expect(existsSync(firstWorktreePath)).toBeTrue();
    expect(existsSync(secondWorktreePath)).toBeFalse();
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

  test("adds a numeric suffix when the default pr id is already occupied", async () => {
    const repo = await createTestRepo();
    const headBranch = "feature/pr-123";
    const occupiedResult = runCliCapture(
      ["new", "feature-pr-collision", "--id", headBranch, "--no-cd"],
      repo.repoRoot
    );

    assertProcessSuccess(
      occupiedResult.status,
      occupiedResult.stderr,
      occupiedResult.stdout
    );

    const occupiedPath = readCliValue(occupiedResult.stdout, "WT_PATH");
    const prResult = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ headBranch }),
    });

    assertProcessSuccess(prResult.status, prResult.stderr, prResult.stdout);

    const prPath = readCliValue(prResult.stdout, "WT_PATH");
    const prId = readCliValue(prResult.stdout, "WT_ID");

    expect(prPath).not.toBe(occupiedPath);
    expect(prId).toBe(`${headBranch}-1`);
    expect(prPath).toContain(`${repo.repoName}-feature-pr-123-1`);
    expect(prResult.stdout).toContain(
      `Adjusted WT_ID from ${headBranch} to ${headBranch}-1 because that ID is already in use.`
    );
    expect(existsSync(prPath)).toBeTrue();
  });

  test("increments the pr id suffix until it finds an unused id", async () => {
    const repo = await createTestRepo();
    const headBranch = "feature/pr-123";

    runCli(["new", "feature-pr-collision-a", "--id", headBranch, "--no-cd"], repo.repoRoot);
    runCli(
      ["new", "feature-pr-collision-b", "--id", `${headBranch}-1`, "--no-cd"],
      repo.repoRoot
    );

    const prResult = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ headBranch }),
    });

    assertProcessSuccess(prResult.status, prResult.stderr, prResult.stdout);

    const prPath = readCliValue(prResult.stdout, "WT_PATH");
    const prId = readCliValue(prResult.stdout, "WT_ID");

    expect(prId).toBe(`${headBranch}-2`);
    expect(prPath).toContain(`${repo.repoName}-feature-pr-123-2`);
    expect(existsSync(prPath)).toBeTrue();
  });

  test("shows an actionable error when gh is unavailable and no pr worktree exists", async () => {
    const repo = await createTestRepo();
    const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ available: false }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("GitHub CLI (`gh`) is not installed");
  });

  test("shows an actionable error when gh is not authenticated and no pr worktree exists", async () => {
    const repo = await createTestRepo();
    const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ authenticated: false }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "GitHub CLI is not authenticated. Run `gh auth login`."
    );
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
