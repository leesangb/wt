import { spawnSync } from "child_process";
import { AppError } from "../../app/errors.js";

interface GithubCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface PullRequestInfo {
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
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

export async function getPullRequestInfo(
  repoRoot: string,
  pullRequestNumber: string
): Promise<PullRequestInfo> {
  const result = runGithubCommand(
    [
      "pr",
      "view",
      pullRequestNumber,
      "--json",
      "baseRefName,headRefName,headRefOid",
    ],
    repoRoot
  );

  if (result.status !== 0) {
    throw new AppError(
      `Could not load PR #${pullRequestNumber}: ${getGithubErrorMessage(result)}`
    );
  }

  let info: Partial<PullRequestInfo>;

  try {
    info = JSON.parse(result.stdout) as Partial<PullRequestInfo>;
  } catch {
    throw new AppError(`Could not parse PR #${pullRequestNumber} details from GitHub CLI`);
  }

  if (!info.baseRefName || !info.headRefName || !info.headRefOid) {
    throw new AppError(`Could not determine branch information for PR #${pullRequestNumber}`);
  }

  return {
    baseRefName: info.baseRefName,
    headRefName: info.headRefName,
    headRefOid: info.headRefOid,
  };
}

export async function checkoutPullRequest(
  worktreePath: string,
  pullRequestNumber: string
): Promise<void> {
  const result = runGithubCommand(["pr", "checkout", pullRequestNumber], worktreePath);

  if (result.status !== 0) {
    throw new AppError(
      `Could not check out PR #${pullRequestNumber}: ${getGithubErrorMessage(result)}`
    );
  }
}
