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
import { renderShellWrapper } from "./infra/shell/installer.js";
import { WORKTREE_GITIGNORE_CONTENT } from "./infra/storage/worktree-meta-store.js";

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
  prNumber?: string;
  prUrl?: string;
}

const tempDirs: string[] = [];
const cliEntry = fileURLToPath(new URL("./index.ts", import.meta.url));
const projectRoot = fileURLToPath(new URL("../", import.meta.url));

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

function runProjectScript(
  scriptName: "install.sh" | "uninstall.sh",
  args: string[] = [],
  options: CliRunOptions = {}
): CliRunResult {
  const result = spawnSync("bash", [join(projectRoot, scriptName), ...args], {
    cwd: projectRoot,
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

async function createGitRepo(): Promise<TestRepo> {
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

  return {
    originDir,
    repoName,
    repoRoot,
    worktreeRoot,
  };
}

async function createTestRepo(): Promise<TestRepo> {
  const repo = await createGitRepo();

  runCli(["init"], repo.repoRoot);

  const settingsPath = join(repo.repoRoot, ".wt", "settings.json");
  const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  settings.worktreeDir = repo.worktreeRoot;
  writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

  return repo;
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
  const cliPath = join(tempDir, "wt");
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

function createBashWrapper(tempDir: string, binaryPath: string): string {
  const wrapperPath = join(tempDir, "wt.bash");
  writeFileSync(
    wrapperPath,
    renderShellWrapper("bash", binaryPath),
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
  const prNumber = options.prNumber ?? "123";
  const prUrl =
    options.prUrl ?? `https://github.com/example/repo/pull/${prNumber}`;

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
        "  selector=$3",
        `  if [ "$selector" = "${headBranch}" ]; then`,
          `    printf '%s\\n' '{"number":${prNumber},"url":"${prUrl}"}'`,
        "    exit 0",
        "  fi",
        `  if [ "$selector" = "${prNumber}" ]; then`,
        `    printf '%s\\n' '{"baseRefName":"${baseBranch}","headRefName":"${headBranch}","headRefOid":"${headRefOid}","number":${prNumber},"url":"${prUrl}"}'`,
        "    exit 0",
        "  fi",
        '  echo "no pull request found" >&2',
        "  exit 1",
        "fi",
        'if [ "$1" = "pr" ] && [ "${2:-}" = "list" ]; then',
        `  printf '%s\\n' '[{"number":${prNumber},"url":"${prUrl}","headRefName":"${headBranch}"}]'`,
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
  const mergedPath = [envOverrides.PATH, process.env.PATH].filter(Boolean).join(":");
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
      ...envOverrides,
      REPO_ROOT: repoRoot,
      WRAPPER_PATH: wrapperPath,
      PATH: mergedPath,
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

async function waitFor(
  check: () => boolean,
  timeoutMs: number = 5000,
  intervalMs: number = 50
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (check()) {
      return;
    }

    await Bun.sleep(intervalMs);
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("cli e2e", () => {
  test("init adds the local settings ignore entry without duplicating it", async () => {
    const repo = await createGitRepo();

    const initResult = runCliCapture(["init"], repo.repoRoot);
    assertProcessSuccess(
      initResult.status,
      initResult.stderr,
      initResult.stdout
    );

    const gitignorePath = join(repo.repoRoot, ".wt", ".gitignore");
    expect(readFileSync(gitignorePath, "utf-8")).toBe(
      "settings.local.json\n"
    );
    expect(existsSync(join(repo.repoRoot, ".gitignore"))).toBeFalse();

    const rerunResult = runCliCapture(["init"], repo.repoRoot);
    assertProcessSuccess(
      rerunResult.status,
      rerunResult.stderr,
      rerunResult.stdout
    );

    expect(
      readFileSync(gitignorePath, "utf-8")
        .split(/\r?\n/)
        .filter((line) => line === "settings.local.json")
    ).toHaveLength(1);
  });

  test("shell install writes a wrapper with the requested binary path", () => {
    const tempHome = makeTempDir("wt-shell-install-");
    const binaryPath = join(tempHome, "bin", "wt");
    const wrapperPath = join(tempHome, ".wt", "shell", "wt.bash");
    const appendCommand =
      `printf '\\nsource ~/.wt/shell/wt.bash\\n' >> ~/.bashrc`;
    const result = runCliCapture(
      [
        "shell",
        "install",
        "bash",
        "--binary-path",
        binaryPath,
      ],
      tempHome,
      {
        env: {
          ...process.env,
          HOME: tempHome,
        },
      }
    );

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    expect(readFileSync(wrapperPath, "utf-8")).toBe(
      renderShellWrapper("bash", binaryPath)
    );
    expect(result.stdout).toContain("~/.wt/shell/wt.bash");
    expect(result.stdout).toContain(appendCommand);
  });

  test("shell install defaults to the current launch command", () => {
    const tempHome = makeTempDir("wt-shell-install-default-");
    const wrapperPath = join(tempHome, ".wt", "shell", "wt.bash");
    const result = runCliCapture(["shell", "install", "bash"], tempHome, {
      env: {
        ...process.env,
        HOME: tempHome,
      },
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    const wrapper = readFileSync(wrapperPath, "utf-8");
    expect(wrapper).toContain(`"${process.execPath}" "${cliEntry}" "$@"`);
    expect(wrapper).toContain(
      `"${process.execPath}" "${cliEntry}" list --completion bash 2>/dev/null`
    );
  });

  test("shell install prints tilde-based copy-paste commands for home paths", () => {
    const tempHome = makeTempDir("wt-shell-home-");
    const wrapperPath = join(tempHome, ".wt", "shell", "wt.zsh");
    const result = runCliCapture(["shell", "install", "zsh"], tempHome, {
      env: {
        ...process.env,
        HOME: tempHome,
      },
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    expect(readFileSync(wrapperPath, "utf-8")).toContain(
      `"${process.execPath}" "${cliEntry}" "$@"`
    );
    expect(result.stdout).toContain("~/.wt/shell/wt.zsh");
    expect(result.stdout).toContain(
      `printf '\\nsource ~/.wt/shell/wt.zsh\\n' >> ~/.zshrc`
    );
  });

  test("install.sh --force rewrites an existing shell source line even when it is the only line", () => {
    const tempHome = makeTempDir("wt-install-force-home-");
    const zshrcPath = join(tempHome, ".zshrc");
    writeFileSync(zshrcPath, 'source "/tmp/old/.wt/shell/wt.zsh"\n');

    const result = runProjectScript("install.sh", ["--force"], {
      env: {
        HOME: tempHome,
      },
      input: "",
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);

    const zshrc = readFileSync(zshrcPath, "utf-8");
    const sourceLines = zshrc
      .split(/\r?\n/)
      .filter((line) => line.includes("source") && line.includes("wt.zsh"));

    expect(sourceLines).toEqual([
      `source "${join(tempHome, ".wt", "shell", "wt.zsh")}"`
    ]);
  });

  test("uninstall.sh removes a standalone install and shell integration", () => {
    const tempHome = makeTempDir("wt-uninstall-home-");
    const zshrcPath = join(tempHome, ".zshrc");
    const bashrcPath = join(tempHome, ".bashrc");
    const fishConfigPath = join(tempHome, ".config", "fish", "config.fish");

    mkdirSync(join(tempHome, ".config", "fish"), { recursive: true });
    writeFileSync(zshrcPath, "# zsh config\n");
    writeFileSync(bashrcPath, "# bash config\n");
    writeFileSync(fishConfigPath, "# fish config\n");

    const installResult = runProjectScript("install.sh", [], {
      env: {
        HOME: tempHome,
      },
      input: "",
    });

    assertProcessSuccess(
      installResult.status,
      installResult.stderr,
      installResult.stdout
    );
    expect(existsSync(join(tempHome, ".local", "bin", "wt"))).toBe(true);
    expect(existsSync(join(tempHome, ".wt", "shell"))).toBe(true);

    const uninstallResult = runProjectScript("uninstall.sh", [], {
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin",
      },
    });

    assertProcessSuccess(
      uninstallResult.status,
      uninstallResult.stderr,
      uninstallResult.stdout
    );

    expect(existsSync(join(tempHome, ".local", "bin", "wt"))).toBe(false);
    expect(existsSync(join(tempHome, ".wt", "shell"))).toBe(false);
    expect(readFileSync(zshrcPath, "utf-8")).not.toContain("wt/shell/wt.zsh");
    expect(readFileSync(bashrcPath, "utf-8")).not.toContain("wt/shell/wt.bash");
    expect(readFileSync(fishConfigPath, "utf-8")).not.toContain("wt/shell/wt.fish");
  });

  test("uninstall.sh delegates Homebrew installs and removes a lone source line", () => {
    const tempHome = makeTempDir("wt-uninstall-homebrew-home-");
    const binDir = join(tempHome, "bin");
    const brewPath = join(binDir, "brew");
    const brewLogPath = join(tempHome, "brew.log");
    const shellDir = join(tempHome, ".wt", "shell");
    const zshrcPath = join(tempHome, ".zshrc");

    mkdirSync(binDir, { recursive: true });
    mkdirSync(shellDir, { recursive: true });
    writeFileSync(join(shellDir, "wt.zsh"), "# wrapper\n");
    writeFileSync(zshrcPath, `source "${join(shellDir, "wt.zsh")}"\n`);
    writeFileSync(
      brewPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf \'%s\\n\' \"$*\" >> \"$BREW_LOG\"',
        'if [ \"$1\" = \"list\" ] && [ \"${2:-}\" = \"--formula\" ] && [ \"${3:-}\" = \"wt\" ]; then',
        "  exit 0",
        "fi",
        'if [ \"$1\" = \"uninstall\" ] && [ \"${2:-}\" = \"wt\" ]; then',
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    const result = runProjectScript("uninstall.sh", [], {
      env: {
        BREW_LOG: brewLogPath,
        HOME: tempHome,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    expect(readFileSync(brewLogPath, "utf-8")).toContain("list --formula wt");
    expect(readFileSync(brewLogPath, "utf-8")).toContain("uninstall wt");
    expect(existsSync(shellDir)).toBe(false);
    expect(readFileSync(zshrcPath, "utf-8")).toBe("");
  });

  test("uninstall.sh removes both standalone and Homebrew installs when both are present", () => {
    const tempHome = makeTempDir("wt-uninstall-mixed-home-");
    const binDir = join(tempHome, "bin");
    const brewPath = join(binDir, "brew");
    const brewLogPath = join(tempHome, "brew.log");
    const localBinaryPath = join(tempHome, ".local", "bin", "wt");

    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(tempHome, ".local", "bin"), { recursive: true });
    writeFileSync(localBinaryPath, "binary\n");
    writeFileSync(
      brewPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf \'%s\\n\' \"$*\" >> \"$BREW_LOG\"',
        'if [ \"$1\" = \"list\" ] && [ \"${2:-}\" = \"--formula\" ] && [ \"${3:-}\" = \"wt\" ]; then',
        "  exit 0",
        "fi",
        'if [ \"$1\" = \"uninstall\" ] && [ \"${2:-}\" = \"wt\" ]; then',
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    const result = runProjectScript("uninstall.sh", [], {
      env: {
        BREW_LOG: brewLogPath,
        HOME: tempHome,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    expect(existsSync(localBinaryPath)).toBe(false);
    expect(readFileSync(brewLogPath, "utf-8")).toContain("list --formula wt");
    expect(readFileSync(brewLogPath, "utf-8")).toContain("uninstall wt");
  });

  test("uninstall.sh still removes shell config when Homebrew uninstall fails", () => {
    const tempHome = makeTempDir("wt-uninstall-homebrew-failure-home-");
    const binDir = join(tempHome, "bin");
    const brewPath = join(binDir, "brew");
    const brewLogPath = join(tempHome, "brew.log");
    const shellDir = join(tempHome, ".wt", "shell");
    const zshrcPath = join(tempHome, ".zshrc");

    mkdirSync(binDir, { recursive: true });
    mkdirSync(shellDir, { recursive: true });
    writeFileSync(join(shellDir, "wt.zsh"), "# wrapper\n");
    writeFileSync(zshrcPath, `source "${join(shellDir, "wt.zsh")}"\n`);
    writeFileSync(
      brewPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf \'%s\\n\' \"$*\" >> \"$BREW_LOG\"',
        'if [ \"$1\" = \"list\" ] && [ \"${2:-}\" = \"--formula\" ] && [ \"${3:-}\" = \"wt\" ]; then',
        "  exit 0",
        "fi",
        'if [ \"$1\" = \"uninstall\" ] && [ \"${2:-}\" = \"wt\" ]; then',
        "  exit 1",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    const result = runProjectScript("uninstall.sh", [], {
      env: {
        BREW_LOG: brewLogPath,
        HOME: tempHome,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Homebrew uninstall failed; continuing shell cleanup");
    expect(result.stdout).toContain("Removing zsh wrapper");
    expect(readFileSync(brewLogPath, "utf-8")).toContain("uninstall wt");
    expect(existsSync(shellDir)).toBe(false);
    expect(readFileSync(zshrcPath, "utf-8")).toBe("");
  });

  test("wt uninstall removes a discovered standalone install and shell integration", () => {
    const tempHome = makeTempDir("wt-cli-uninstall-home-");
    const binaryPath = join(tempHome, ".local", "bin", "wt");
    const shellDir = join(tempHome, ".wt", "shell");
    const zshrcPath = join(tempHome, ".zshrc");
    const bashrcPath = join(tempHome, ".bashrc");
    const fishConfigPath = join(tempHome, ".config", "fish", "config.fish");

    mkdirSync(join(tempHome, ".local", "bin"), { recursive: true });
    mkdirSync(join(tempHome, ".config", "fish"), { recursive: true });
    mkdirSync(shellDir, { recursive: true });
    writeFileSync(binaryPath, "binary\n");
    writeFileSync(join(shellDir, "wt.zsh"), "# wrapper\n");
    writeFileSync(join(shellDir, "wt.bash"), "# wrapper\n");
    writeFileSync(join(shellDir, "wt.fish"), "# wrapper\n");
    writeFileSync(zshrcPath, `source "${join(shellDir, "wt.zsh")}"\n`);
    writeFileSync(bashrcPath, `source "${join(shellDir, "wt.bash")}"\n`);
    writeFileSync(fishConfigPath, `source "${join(shellDir, "wt.fish")}"\n`);

    const result = runCliCapture(["uninstall"], tempHome, {
      env: {
        HOME: tempHome,
      },
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    expect(result.stdout).toContain("Removed standalone wt binary");
    expect(existsSync(binaryPath)).toBe(false);
    expect(existsSync(shellDir)).toBe(false);
    expect(readFileSync(zshrcPath, "utf-8")).toBe("");
    expect(readFileSync(bashrcPath, "utf-8")).toBe("");
    expect(readFileSync(fishConfigPath, "utf-8")).toBe("");
  });

  test("wt uninstall delegates to Homebrew when no standalone install exists", () => {
    const tempHome = makeTempDir("wt-cli-uninstall-homebrew-home-");
    const binDir = join(tempHome, "bin");
    const brewPath = join(binDir, "brew");
    const brewLogPath = join(tempHome, "brew.log");
    const shellDir = join(tempHome, ".wt", "shell");
    const zshrcPath = join(tempHome, ".zshrc");

    mkdirSync(binDir, { recursive: true });
    mkdirSync(shellDir, { recursive: true });
    writeFileSync(join(shellDir, "wt.zsh"), "# wrapper\n");
    writeFileSync(zshrcPath, `source "${join(shellDir, "wt.zsh")}"\n`);
    writeFileSync(
      brewPath,
      [
        "#!/bin/sh",
        "set -eu",
        'printf \'%s\\n\' \"$*\" >> \"$BREW_LOG\"',
        'if [ \"$1\" = \"list\" ] && [ \"${2:-}\" = \"--formula\" ] && [ \"${3:-}\" = \"wt\" ]; then',
        "  exit 0",
        "fi",
        'if [ \"$1\" = \"uninstall\" ] && [ \"${2:-}\" = \"wt\" ]; then',
        "  exit 0",
        "fi",
        "exit 1",
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    const result = runCliCapture(["uninstall"], tempHome, {
      env: {
        BREW_LOG: brewLogPath,
        HOME: tempHome,
        PATH: `${binDir}:${process.env.PATH}`,
      },
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);
    expect(result.stdout).toContain("Uninstalled wt via Homebrew");
    expect(readFileSync(brewLogPath, "utf-8")).toContain("list --formula wt");
    expect(readFileSync(brewLogPath, "utf-8")).toContain("uninstall wt");
    expect(existsSync(shellDir)).toBe(false);
    expect(readFileSync(zshrcPath, "utf-8")).toBe("");
  });

  test("wt uninstall shows an actionable error when no installation is detected", () => {
    const tempHome = makeTempDir("wt-cli-uninstall-missing-home-");
    const result = runCliCapture(["uninstall"], tempHome, {
      env: {
        HOME: tempHome,
        PATH: "/usr/bin:/bin",
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Could not find an installed wt binary to uninstall");
  });

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

  test("copies configured files into a new worktree while respecting excludes", async () => {
    const repo = await createTestRepo();
    const branchName = "feature-copy-config";
    const worktreeId = "copy-config";
    const worktreePath = getWorktreePath(repo, worktreeId);

    mkdirSync(join(repo.repoRoot, "node_modules", "pkg"), { recursive: true });
    mkdirSync(join(repo.repoRoot, "cache"), { recursive: true });
    writeFileSync(join(repo.repoRoot, ".gitignore"), "node_modules/\ncache/\n");
    writeFileSync(join(repo.repoRoot, "README.md"), "local tracked change\n");
    writeFileSync(join(repo.repoRoot, ".env"), "TOKEN=repo\n");
    writeFileSync(
      join(repo.repoRoot, ".wt", "settings.local.json"),
      JSON.stringify({ copy: { include: ["**/*"] } }, null, 2)
    );
    writeFileSync(join(repo.repoRoot, "node_modules", "pkg", "index.js"), "module\n");
    writeFileSync(join(repo.repoRoot, "cache", "data.txt"), "cached\n");

    updateSettings(repo.repoRoot, (settings) => {
      settings.copy = {
        include: ["**/*"],
        exclude: [".wt/settings.json"],
      };
    });

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);

    expect(readFileSync(join(worktreePath, ".env"), "utf-8")).toBe("TOKEN=repo\n");
    expect(readFileSync(join(worktreePath, "README.md"), "utf-8")).toBe("base\n");
    expect(
      readFileSync(join(worktreePath, ".wt", "settings.local.json"), "utf-8")
    ).toContain('"include": [');
    expect(existsSync(join(worktreePath, ".wt", "settings.json"))).toBeFalse();
    expect(readFileSync(join(worktreePath, ".wt", ".gitignore"), "utf-8")).toBe(
      WORKTREE_GITIGNORE_CONTENT
    );
    expect(existsSync(join(worktreePath, "node_modules"))).toBeFalse();
    expect(existsSync(join(worktreePath, "cache"))).toBeFalse();
  });

  test("cleans up a partially created worktree when push fails", async () => {
    const repo = await createTestRepo();
    const worktreeId = "pushfail123";
    const branchName = "feature-push-fail";
    const worktreePath = getWorktreePath(repo, worktreeId);

    await $`git -C ${repo.repoRoot} remote remove origin`.quiet();

    const result = runCliCapture(
      ["new", branchName, "--id", worktreeId, "--no-cd"],
      repo.repoRoot
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("git push failed");
    expect(result.stderr).toContain("Cleaned up the partially created worktree");
    expect(existsSync(worktreePath)).toBeFalse();

    const branchResult = spawnSync(
      "git",
      [
        "-C",
        repo.repoRoot,
        "show-ref",
        "--verify",
        "--quiet",
        `refs/heads/${branchName}`,
      ],
      {
        encoding: "utf-8",
      }
    );

    expect(branchResult.status).toBe(1);
  });

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
    "creates a local branch worktree and navigates via the bash wrapper",
    async () => {
      if (!isShellAvailable("bash")) {
        return;
      }

      const repo = await createTestRepo();
      const branchName = "feature/local-checkout";

      await $`git -C ${repo.repoRoot} branch ${branchName}`.quiet();

      const result = runWrappedBashSession(repo.repoRoot, [
        `wt checkout ${branchName}`,
        "checkout_status=$?",
        'checkout_pwd="$PWD"',
        'printf \'CHECKOUT_STATUS=%s\\nCHECKOUT_PWD=%s\\n\' "$checkout_status" "$checkout_pwd"',
      ]);

      assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

      const checkoutStatus = Number(
        readOutputValue(result.stdout, "CHECKOUT_STATUS")
      );
      const checkoutPwd = readOutputValue(result.stdout, "CHECKOUT_PWD");
      const worktreePath = readCliValue(result.stdout, "WT_PATH");
      const worktreeId = readCliValue(result.stdout, "WT_ID");
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

      expect(checkoutStatus).toBe(0);
      expect(realpathSync(checkoutPwd)).toBe(realpathSync(worktreePath));
      expect(worktreeId).toBe(branchName);
      expect(worktreePath).toContain(`${repo.repoName}-feature-local-checkout`);
      expect(branchResult.stdout.trim()).toBe(branchName);
      expect(existsSync(join(worktreePath, ".wt", "meta.json"))).toBeTrue();
    }
  );

  test("reuses an existing local branch worktree via the switch alias", async () => {
    if (!isShellAvailable("bash")) {
      return;
    }

    const repo = await createTestRepo();
    const branchName = "feature/local-reuse";

    await $`git -C ${repo.repoRoot} branch ${branchName}`.quiet();

    const createResult = runCliCapture(
      ["checkout", branchName, "--no-cd"],
      repo.repoRoot
    );

    assertProcessSuccess(
      createResult.status,
      createResult.stderr,
      createResult.stdout
    );

    const worktreePath = readCliValue(createResult.stdout, "WT_PATH");
    const reuseResult = runWrappedBashSession(repo.repoRoot, [
      `wt switch ${branchName}`,
      "switch_status=$?",
      'switch_pwd="$PWD"',
      'printf \'SWITCH_STATUS=%s\\nSWITCH_PWD=%s\\n\' "$switch_status" "$switch_pwd"',
    ]);

    assertProcessSuccess(
      reuseResult.processStatus,
      reuseResult.stderr,
      reuseResult.stdout
    );

    expect(Number(readOutputValue(reuseResult.stdout, "SWITCH_STATUS"))).toBe(
      0
    );
    expect(realpathSync(readOutputValue(reuseResult.stdout, "SWITCH_PWD"))).toBe(
      realpathSync(worktreePath)
    );
    expect(reuseResult.stdout).toContain(
      `Using existing worktree: ${branchName}`
    );
  });

  test("shows an actionable error when a local branch does not exist", async () => {
    const repo = await createTestRepo();
    const branchName = "feature/missing-branch";
    const worktreePath = getWorktreePath(repo, branchName);
    const result = runCliCapture(
      ["checkout", branchName, "--no-cd"],
      repo.repoRoot
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `Local branch ${branchName} does not exist.`
    );
    expect(result.stderr).toContain(`wt new ${branchName}`);
    expect(existsSync(worktreePath)).toBeFalse();
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
      const worktreeId = readCliValue(result.stdout, "WT_ID");
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
      expect(worktreeId).toBe("pr-123");
      expect(worktreePath).toContain(`${repo.repoName}-pr-123`);
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
    "creates a pull request worktree after fetching a missing remote base branch",
    async () => {
      const repo = await createTestRepo();
      const headBranch = "feature/pr-123";
      const baseBranch = "release/1.0";

      await $`git -C ${repo.repoRoot} checkout -b ${baseBranch}`.quiet();
      writeFileSync(join(repo.repoRoot, "README.md"), "base\nrelease branch\n");
      await $`git -C ${repo.repoRoot} add README.md`.quiet();
      await $`git -C ${repo.repoRoot} commit -m release-base`.quiet();
      await $`git -C ${repo.repoRoot} push -u origin ${baseBranch}`.quiet();
      await $`git -C ${repo.repoRoot} checkout main`.quiet();
      await $`git -C ${repo.repoRoot} branch -D ${baseBranch}`.quiet();
      await $`git -C ${repo.repoRoot} update-ref -d refs/remotes/origin/${baseBranch}`.quiet();
      await $`git -C ${repo.repoRoot} config remote.origin.fetch +refs/heads/main:refs/remotes/origin/main`.quiet();

      const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
        env: createFakeGithubEnv({ headBranch, baseBranch }),
      });

      assertProcessSuccess(result.status, result.stderr, result.stdout);

      const worktreePath = readCliValue(result.stdout, "WT_PATH");

      expect(readFileSync(join(worktreePath, "README.md"), "utf-8")).toContain(
        "release branch"
      );
      expect(readFileSync(join(worktreePath, "README.md"), "utf-8")).toContain(
        "pr 123"
      );
    }
  );

  test("shows an actionable error when the PR base branch cannot be resolved", async () => {
    const repo = await createTestRepo();
    const headBranch = "feature/pr-123";
    const result = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ headBranch, baseBranch: "release/missing" }),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "Could not resolve PR base branch release/missing from origin."
    );
    expect(result.stderr).not.toContain("fatal: invalid reference:");
  });

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

      const worktreePath = getWorktreePath(repo, "pr-123");
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
    const worktreePath = getWorktreePath(repo, "pr-123");
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

  test("marks the main worktree in list output", async () => {
    const repo = await createTestRepo();
    const worktreeId = "mainmark123";
    const branchName = "feature-main-marker";

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);

    const result = runCliCapture(["list"], getWorktreePath(repo, worktreeId));
    assertProcessSuccess(result.status, result.stderr, result.stdout);

    const lines = result.stdout
      .split(/\r?\n/)
      .map(line => line.trimEnd());
    const mainWorktreeId = basename(repo.repoRoot);
    const mainIdLine = lines.find(line => line.startsWith(`ID:      ${mainWorktreeId}`));
    const linkedIdLine = lines.find(line => line.startsWith(`ID:      ${worktreeId}`));

    expect(mainIdLine).toBe(`ID:      ${mainWorktreeId} [main]`);
    expect(linkedIdLine).toBe(`ID:      ${worktreeId} (current)`);
  });

  test("shows a linked pull request URL in list output for a branch worktree", async () => {
    const repo = await createTestRepo();
    const worktreeId = "prlink123";
    const branchName = "feature-pr-link";
    const prUrl = "https://github.com/example/repo/pull/456";
    const ghLogPath = join(repo.repoRoot, "gh.log");

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);

    const result = runCliCapture(["list"], repo.repoRoot, {
      env: createFakeGithubEnv({
        headBranch: branchName,
        logPath: ghLogPath,
        prNumber: "456",
        prUrl,
      }),
    });
    assertProcessSuccess(result.status, result.stderr, result.stdout);

    const ghLog = readFileSync(ghLogPath, "utf-8");

    expect(result.stdout).toContain(`ID:      ${worktreeId}`);
    expect(result.stdout).toContain(`PR:      #456 ${prUrl}`);
    expect(ghLog).toContain("pr list --state open --limit 1000 --json number,url,headRefName");
    expect(ghLog).not.toContain(`pr view ${branchName}`);
  });

  test("shows stored pull request URLs in list output for PR worktrees", async () => {
    const repo = await createTestRepo();
    const prNumber = "789";
    const branchName = "feature-pr-worktree-link";
    const prUrl = "https://github.com/example/repo/pull/789";

    const createResult = runCliCapture(["pr", prNumber, "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({
        headBranch: branchName,
        prNumber,
        prUrl,
      }),
    });
    assertProcessSuccess(
      createResult.status,
      createResult.stderr,
      createResult.stdout
    );

    const listResult = runCliCapture(["list"], repo.repoRoot);
    assertProcessSuccess(listResult.status, listResult.stderr, listResult.stdout);

    expect(listResult.stdout).toContain(`ID:      pr-${prNumber}`);
    expect(listResult.stdout).toContain(`PR:      #${prNumber} ${prUrl}`);
  });

  test("lists a detached main worktree instead of hiding it", async () => {
    const repo = await createGitRepo();

    await $`git -C ${repo.repoRoot} checkout --detach`.quiet();

    const result = runCliCapture(["list"], repo.repoRoot);
    assertProcessSuccess(result.status, result.stderr, result.stdout);

    expect(result.stdout).not.toContain("No worktrees found");
    expect(result.stdout).toContain(
      `ID:      ${basename(repo.repoRoot)} [main] (current)`
    );
    expect(result.stdout).toContain("Branch:  (detached) @ ");
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

  test("rejects unsupported completion formats", async () => {
    const repo = await createTestRepo();

    const result = runCliCapture(
      ["list", "--completion", "bogus"],
      repo.repoRoot
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Unsupported completion format "bogus". Expected one of: bash, zsh, fish.'
    );
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

  test("ignores prunable worktree entries in list output", async () => {
    const repo = await createTestRepo();
    const worktreeId = "prunable123";
    const branchName = "feature-prunable";
    const worktreePath = getWorktreePath(repo, worktreeId);

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
    rmSync(worktreePath, { recursive: true, force: true });

    const result = runCliCapture(["list"], repo.repoRoot);
    assertProcessSuccess(result.status, result.stderr, result.stdout);

    expect(result.stdout).toContain(
      `ID:      ${basename(repo.repoRoot)} [main] (current)`
    );
    expect(result.stdout).not.toContain(worktreeId);
    expect(result.stderr).toBe("");
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

  test("detects merged status even after the remote branch is deleted", async () => {
    const repo = await createTestRepo();
    const worktreeId = "mergeddeleted123";
    const branchName = "feature-merged-deleted";
    const worktreePath = getWorktreePath(repo, worktreeId);

    runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
    writeFileSync(join(worktreePath, "README.md"), "base\nmerged-deleted\n");
    await $`git -C ${worktreePath} add README.md`.quiet();
    await $`git -C ${worktreePath} commit -m merged-deleted`.quiet();
    await $`git -C ${worktreePath} push origin ${branchName}`.quiet();

    // Simulate PR merge on remote: fast-forward main to the branch tip, then delete the remote branch
    const branchTip = (await $`git -C ${repo.repoRoot} rev-parse origin/${branchName}`.text()).trim();
    await $`git -C ${repo.originDir} update-ref refs/heads/main ${branchTip}`.quiet();
    await $`git -C ${repo.originDir} branch -D ${branchName}`.quiet();
    await $`git -C ${repo.repoRoot} fetch --prune`.quiet();

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
    expect(completionLine).toContain("merged");
    expect(completionLine).not.toContain("not merged");
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

  test(
    "removes the current worktree from a nested directory and returns the shell to the main worktree",
    async () => {
      if (!isShellAvailable("bash")) {
        return;
      }

      const repo = await createTestRepo();
      const worktreeId = "rmcwd123";
      const branchName = "feature-rm-current";
      const worktreePath = getWorktreePath(repo, worktreeId);
      const nestedDir = join(worktreePath, "nested");

      runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
      mkdirSync(nestedDir, { recursive: true });

      const result = runWrappedBashSession(repo.repoRoot, [
        `builtin cd "${nestedDir}"`,
        `wt rm ${worktreeId} --keep-branch`,
        "rm_status=$?",
        'rm_pwd="$PWD"',
        'printf \'RM_STATUS=%s\\nRM_PWD=%s\\n\' "$rm_status" "$rm_pwd"',
      ]);

      assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

      expect(Number(readOutputValue(result.stdout, "RM_STATUS"))).toBe(0);
      expect(realpathSync(readOutputValue(result.stdout, "RM_PWD"))).toBe(
        realpathSync(repo.repoRoot)
      );
      expect(existsSync(worktreePath)).toBeFalse();
    }
  );

  test(
    "returns the shell to the main worktree after removing the current worktree in a batch that exits nonzero",
    async () => {
      if (!isShellAvailable("bash")) {
        return;
      }

      const repo = await createTestRepo();
      const worktreeId = "rmbatch123";
      const branchName = "feature-rm-batch-current";
      const worktreePath = getWorktreePath(repo, worktreeId);
      const nestedDir = join(worktreePath, "nested");

      runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
      mkdirSync(nestedDir, { recursive: true });

      const result = runWrappedBashSession(repo.repoRoot, [
        `builtin cd "${nestedDir}"`,
        `wt rm ${worktreeId} missing --keep-branch >/dev/null 2>/dev/null`,
        "rm_status=$?",
        'rm_pwd="$PWD"',
        'printf \'RM_STATUS=%s\\nRM_PWD=%s\\n\' "$rm_status" "$rm_pwd"',
      ]);

      assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

      expect(Number(readOutputValue(result.stdout, "RM_STATUS"))).toBe(1);
      expect(realpathSync(readOutputValue(result.stdout, "RM_PWD"))).toBe(
        realpathSync(repo.repoRoot)
      );
      expect(existsSync(worktreePath)).toBeFalse();
    }
  );

  test(
    "returns the shell to the main worktree when branch deletion fails after removing the current worktree",
    async () => {
      if (!isShellAvailable("bash")) {
        return;
      }

      const repo = await createTestRepo();
      const worktreeId = "rmbranchfail123";
      const branchName = "feature-rm-branch-fail";
      const worktreePath = getWorktreePath(repo, worktreeId);
      const nestedDir = join(worktreePath, "nested");
      const lockedWorktreePath = join(repo.worktreeRoot, `${repo.repoName}-branch-lock`);

      runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
      await $`git -C ${repo.repoRoot} worktree add --force ${lockedWorktreePath} ${branchName}`.quiet();
      mkdirSync(nestedDir, { recursive: true });

      const result = runWrappedBashSession(repo.repoRoot, [
        `builtin cd "${nestedDir}"`,
        `wt rm ${worktreeId} >/dev/null 2>/dev/null`,
        "rm_status=$?",
        'rm_pwd="$PWD"',
        'printf \'RM_STATUS=%s\\nRM_PWD=%s\\n\' "$rm_status" "$rm_pwd"',
      ]);

      assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

      expect(Number(readOutputValue(result.stdout, "RM_STATUS"))).toBe(1);
      expect(realpathSync(readOutputValue(result.stdout, "RM_PWD"))).toBe(
        realpathSync(repo.repoRoot)
      );
      expect(existsSync(worktreePath)).toBeFalse();
      expect(existsSync(lockedWorktreePath)).toBeTrue();
    }
  );

  test(
    "removes the current worktree even when the main worktree is detached",
    async () => {
      if (!isShellAvailable("bash")) {
        return;
      }

      const repo = await createTestRepo();
      const worktreeId = "rmdetached123";
      const branchName = "feature-rm-detached-main";
      const worktreePath = getWorktreePath(repo, worktreeId);
      const nestedDir = join(worktreePath, "nested");

      runCli(["new", branchName, "--id", worktreeId, "--no-cd"], repo.repoRoot);
      await $`git -C ${repo.repoRoot} checkout --detach`.quiet();
      mkdirSync(nestedDir, { recursive: true });

      const result = runWrappedBashSession(repo.repoRoot, [
        `builtin cd "${nestedDir}"`,
        `wt rm ${worktreeId} --keep-branch`,
        "rm_status=$?",
        'rm_pwd="$PWD"',
        'printf \'RM_STATUS=%s\\nRM_PWD=%s\\n\' "$rm_status" "$rm_pwd"',
      ]);

      assertProcessSuccess(result.processStatus, result.stderr, result.stdout);

      expect(Number(readOutputValue(result.stdout, "RM_STATUS"))).toBe(0);
      expect(realpathSync(readOutputValue(result.stdout, "RM_PWD"))).toBe(
        realpathSync(repo.repoRoot)
      );
      expect(existsSync(worktreePath)).toBeFalse();
    }
  );

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

  test("requires a TTY for cleanup", async () => {
    const repo = await createTestRepo();

    const result = runCliCapture(["clean"], repo.repoRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("wt clean requires an interactive terminal.");
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
      ["new", "feature-pr-collision", "--id", "pr-123", "--no-cd"],
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
    expect(prId).toBe("pr-123-1");
    expect(prPath).toContain(`${repo.repoName}-pr-123-1`);
    expect(prResult.stdout).toContain(
      "Adjusted WT_ID from pr-123 to pr-123-1 because that ID is already in use."
    );
    expect(existsSync(prPath)).toBeTrue();
  });

  test("increments the pr id suffix until it finds an unused id", async () => {
    const repo = await createTestRepo();
    const headBranch = "feature/pr-123";

    runCli(["new", "feature-pr-collision-a", "--id", "pr-123", "--no-cd"], repo.repoRoot);
    runCli(
      ["new", "feature-pr-collision-b", "--id", "pr-123-1", "--no-cd"],
      repo.repoRoot
    );

    const prResult = runCliCapture(["pr", "123", "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ headBranch }),
    });

    assertProcessSuccess(prResult.status, prResult.stderr, prResult.stdout);

    const prPath = readCliValue(prResult.stdout, "WT_PATH");
    const prId = readCliValue(prResult.stdout, "WT_ID");

    expect(prId).toBe("pr-123-2");
    expect(prPath).toContain(`${repo.repoName}-pr-123-2`);
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

  test("runs PR pre and post scripts with a pr-number WT_ID and head-branch WT_BRANCH", async () => {
    const repo = await createTestRepo();
    const prNumber = "123";
    const worktreeId = `pr-${prNumber}`;
    const branchName = "feature/pr-script-hooks";
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

    const result = runCliCapture(["pr", prNumber, "--no-cd"], repo.repoRoot, {
      env: createFakeGithubEnv({ headBranch: branchName }),
    });

    assertProcessSuccess(result.status, result.stderr, result.stdout);

    const preLines = readLines(preEnvPath);
    const postLines = readLines(postEnvPath);
    const expectedFullId = `${repo.repoName}-${worktreeId}`;
    const resolvedRepoRoot = realpathSync(repo.repoRoot);
    const resolvedWorktreePath = realpathSync(worktreePath);

    expect(readCliValue(result.stdout, "WT_ID")).toBe(worktreeId);
    expect(readCliValue(result.stdout, "WT_PATH")).toBe(worktreePath);

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

  test("keeps .wt artifacts out of git status after async post scripts finish", async () => {
    const repo = await createTestRepo();
    const worktreeId = "async-clean";
    const branchName = "feature-async-clean";
    const worktreePath = getWorktreePath(repo, worktreeId);

    updateSettings(repo.repoRoot, settings => {
      settings.scripts = {
        pre: [],
        post: [
          "sleep 0.1",
          "printf 'done\\n' > .wt/post-complete.txt",
        ],
        postMode: "async",
      };
    });

    const result = runCliCapture(
      ["new", branchName, "--id", worktreeId, "--no-cd"],
      repo.repoRoot
    );

    assertProcessSuccess(result.status, result.stderr, result.stdout);

    const statusFilePath = join(worktreePath, ".wt", "post-task.json");

    await waitFor(() => {
      if (!existsSync(statusFilePath)) {
        return false;
      }

      const status = JSON.parse(readFileSync(statusFilePath, "utf-8")) as {
        status: string;
      };

      return status.status === "done";
    });

    const gitStatus = spawnSync(
      "git",
      ["-C", worktreePath, "status", "--short"],
      {
        encoding: "utf-8",
      }
    );

    assertProcessSuccess(gitStatus.status, gitStatus.stderr, gitStatus.stdout);
    expect(gitStatus.stdout.trim()).toBe("");
    expect(existsSync(join(worktreePath, ".wt", "post-task.log"))).toBeTrue();
    expect(existsSync(join(worktreePath, ".wt", "post-complete.txt"))).toBeTrue();
  });

  test("sends macOS notifications when async post scripts start and finish", async () => {
    if (process.platform !== "darwin") {
      return;
    }

    const repo = await createTestRepo();
    const worktreeId = "notify123";
    const branchName = "feature-notify";
    const worktreePath = getWorktreePath(repo, worktreeId);
    const fakeBinDir = makeTempDir("wt-fake-bin-");
    const notificationLogPath = join(fakeBinDir, "osascript.log");
    const fakeOsascriptPath = join(fakeBinDir, "osascript");

    writeFileSync(
      fakeOsascriptPath,
      [
        "#!/bin/sh",
        'printf "%s\\n" "$*" >> "$WT_TEST_OSASCRIPT_LOG"',
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    updateSettings(repo.repoRoot, settings => {
      settings.scripts = {
        pre: [],
        post: [
          "sleep 0.1",
          "printf 'done\\n' > .wt/post-complete.txt",
        ],
        postMode: "async",
      };
    });

    const result = runCliCapture(
      ["new", branchName, "--id", worktreeId, "--no-cd"],
      repo.repoRoot,
      {
        env: {
          PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
          WT_TEST_OSASCRIPT_LOG: notificationLogPath,
        },
      }
    );

    assertProcessSuccess(result.status, result.stderr, result.stdout);

    const statusFilePath = join(worktreePath, ".wt", "post-task.json");

    await waitFor(() => {
      if (!existsSync(statusFilePath) || !existsSync(notificationLogPath)) {
        return false;
      }

      const status = JSON.parse(readFileSync(statusFilePath, "utf-8")) as {
        status: string;
      };
      const notificationLog = readFileSync(notificationLogPath, "utf-8");

      return (
        status.status === "done" &&
        notificationLog.includes(`${branchName} setup finished`) &&
        (notificationLog.match(/display notification/g)?.length ?? 0) === 2
      );
    });

    const notificationLog = readFileSync(notificationLogPath, "utf-8");

    expect(notificationLog).toContain("display notification");
    expect(notificationLog).toContain(`${branchName} setup started`);
    expect(notificationLog).toContain('subtitle "Post scripts running"');
    expect(notificationLog).toContain(`${branchName} setup finished`);
    expect(notificationLog).toContain('with title "wt"');
    expect(notificationLog).toContain('subtitle "Post scripts completed"');
    expect(notificationLog.match(/display notification/g)?.length).toBe(2);
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
