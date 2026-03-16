import { spawnSync } from "child_process";
import { AppError } from "../../app/errors.js";

interface GithubCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

function runGithubCommand(
  args: string[],
  cwd: string
): GithubCommandResult {
  const result = spawnSync("gh", args, {
    cwd,
    encoding: "utf-8",
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error instanceof Error ? result.error : undefined,
  };
}

function isGithubCliUnavailable(result: GithubCommandResult): boolean {
  const message = result.stderr.trim().toLowerCase();

  return (
    (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT" ||
    result.status === 127 ||
    message.includes("command not found")
  );
}

function getGithubErrorMessage(result: GithubCommandResult): string {
  return result.stderr.trim() || result.stdout.trim() || "unknown gh error";
}

export async function ensureGithubCliReady(cwd: string): Promise<void> {
  const versionResult = runGithubCommand(["--version"], cwd);

  if (isGithubCliUnavailable(versionResult)) {
    throw new AppError("GitHub CLI (`gh`) is not installed");
  }

  if (versionResult.status !== 0) {
    throw new AppError(
      `GitHub CLI is unavailable: ${getGithubErrorMessage(versionResult)}`
    );
  }

  const authResult = runGithubCommand(["auth", "status"], cwd);

  if (authResult.status !== 0) {
    throw new AppError("GitHub CLI is not authenticated. Run `gh auth login`.");
  }
}

export async function getPullRequestBaseBranch(
  repoRoot: string,
  pullRequestNumber: string
): Promise<string> {
  const result = runGithubCommand(
    ["pr", "view", pullRequestNumber, "--json", "baseRefName", "--jq", ".baseRefName"],
    repoRoot
  );

  if (result.status !== 0) {
    throw new AppError(
      `Could not load PR #${pullRequestNumber}: ${getGithubErrorMessage(result)}`
    );
  }

  const baseBranch = result.stdout.trim();

  if (!baseBranch) {
    throw new AppError(`Could not determine the base branch for PR #${pullRequestNumber}`);
  }

  return baseBranch;
}

export async function checkoutPullRequest(
  worktreePath: string,
  pullRequestNumber: string,
  branchName: string
): Promise<void> {
  const result = runGithubCommand(
    ["pr", "checkout", pullRequestNumber, "--branch", branchName],
    worktreePath
  );

  if (result.status !== 0) {
    throw new AppError(
      `Could not check out PR #${pullRequestNumber}: ${getGithubErrorMessage(result)}`
    );
  }
}
