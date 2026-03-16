import { spawnSync } from "node:child_process";

class GithubCliError extends Error {}

export class MissingGithubCliError extends GithubCliError {
  constructor() {
    super("GitHub CLI is not installed");
    this.name = "MissingGithubCliError";
  }
}

export class GithubCliAuthenticationError extends GithubCliError {
  constructor() {
    super("GitHub CLI is not authenticated");
    this.name = "GithubCliAuthenticationError";
  }
}

export class GithubPullRequestCheckoutError extends GithubCliError {
  readonly exitCode: number | null;

  constructor(exitCode: number | null) {
    super(`gh pr checkout failed with exit code ${exitCode}`);
    this.name = "GithubPullRequestCheckoutError";
    this.exitCode = exitCode;
  }
}

function runGithubCli(
  args: string[],
  cwd: string,
  stdio: "ignore" | "inherit"
) {
  return spawnSync("gh", args, {
    cwd,
    env: process.env,
    stdio,
  });
}

function assertGithubCliInstalled(
  result: ReturnType<typeof runGithubCli>
): void {
  if (result.error && "code" in result.error && result.error.code === "ENOENT") {
    throw new MissingGithubCliError();
  }
}

export async function ensureGithubCliReady(cwd: string): Promise<void> {
  const versionResult = runGithubCli(["--version"], cwd, "ignore");
  assertGithubCliInstalled(versionResult);

  if (versionResult.status !== 0) {
    throw new MissingGithubCliError();
  }

  const authResult = runGithubCli(["auth", "status"], cwd, "ignore");
  assertGithubCliInstalled(authResult);

  if (authResult.status !== 0) {
    throw new GithubCliAuthenticationError();
  }
}

export async function checkoutPullRequest(
  cwd: string,
  pullRequest: string,
  branchName: string
): Promise<void> {
  const result = runGithubCli(
    ["pr", "checkout", pullRequest, "--branch", branchName, "--force"],
    cwd,
    "inherit"
  );
  assertGithubCliInstalled(result);

  if (result.status !== 0) {
    throw new GithubPullRequestCheckoutError(result.status);
  }
}
