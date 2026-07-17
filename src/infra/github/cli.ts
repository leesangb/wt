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
  number: string;
  url: string;
}

export interface PullRequestLink {
  number: string;
  url: string;
}

export interface OpenPullRequestSummary {
  author: string;
  headRefName: string;
  isDraft: boolean;
  number: string;
  title: string;
}

interface PullRequestListEntry {
  headRefName: string;
  number: number;
  url: string;
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
      "baseRefName,headRefName,headRefOid,number,url",
    ],
    repoRoot
  );

  if (result.status !== 0) {
    throw new AppError(
      `Could not load PR #${pullRequestNumber}: ${getGithubErrorMessage(result)}`
    );
  }

  let info: Partial<{
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
    number: number;
    url: string;
  }>;

  try {
    info = JSON.parse(result.stdout) as typeof info;
  } catch {
    throw new AppError(`Could not parse PR #${pullRequestNumber} details from GitHub CLI`);
  }

  if (
    !info.baseRefName ||
    !info.headRefName ||
    !info.headRefOid ||
    typeof info.number !== "number" ||
    !info.url
  ) {
    throw new AppError(`Could not determine branch information for PR #${pullRequestNumber}`);
  }

  return {
    baseRefName: info.baseRefName,
    headRefName: info.headRefName,
    headRefOid: info.headRefOid,
    number: String(info.number),
    url: info.url,
  };
}

export async function listPullRequestLinks(
  repoRoot: string
): Promise<Map<string, PullRequestLink>> {
  const result = runGithubCommand(
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "1000",
      "--json",
      "number,url,headRefName",
    ],
    repoRoot
  );

  if (result.status !== 0) {
    return new Map();
  }

  let entries: Partial<PullRequestListEntry>[];

  try {
    entries = JSON.parse(result.stdout) as Partial<PullRequestListEntry>[];
  } catch {
    return new Map();
  }

  if (!Array.isArray(entries)) {
    return new Map();
  }

  const linksByBranch = new Map<string, PullRequestLink | null>();

  for (const entry of entries) {
    if (
      !entry.headRefName ||
      typeof entry.number !== "number" ||
      !entry.url
    ) {
      continue;
    }

    if (linksByBranch.has(entry.headRefName)) {
      linksByBranch.set(entry.headRefName, null);
      continue;
    }

    linksByBranch.set(entry.headRefName, {
      number: String(entry.number),
      url: entry.url,
    });
  }

  return new Map(
    [...linksByBranch.entries()].filter(
      (entry): entry is [string, PullRequestLink] => entry[1] !== null
    )
  );
}

export async function listOpenPullRequests(
  repoRoot: string
): Promise<OpenPullRequestSummary[]> {
  const result = runGithubCommand(
    [
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,author,headRefName,isDraft",
    ],
    repoRoot
  );

  if (result.status !== 0) {
    return [];
  }

  let entries: Array<{
    author?: { login?: string };
    headRefName?: string;
    isDraft?: boolean;
    number?: number;
    title?: string;
  }>;

  try {
    entries = JSON.parse(result.stdout) as typeof entries;
  } catch {
    return [];
  }

  if (!Array.isArray(entries)) {
    return [];
  }

  return entries.flatMap((entry) => {
    if (
      typeof entry.number !== "number" ||
      !entry.title ||
      !entry.headRefName
    ) {
      return [];
    }

    return [
      {
        author: entry.author?.login ?? "unknown",
        headRefName: entry.headRefName,
        isDraft: entry.isDraft === true,
        number: String(entry.number),
        title: entry.title,
      },
    ];
  });
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
