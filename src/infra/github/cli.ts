import { spawn } from "child_process";
import { AppError } from "../../app/errors.js";

interface GithubCommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export interface PullRequestInfo {
  author: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  number: string;
  title: string;
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

async function runGithubCommand(
  args: string[],
  cwd: string,
  options: { timeoutMs?: number } = {}
): Promise<GithubCommandResult> {
  return new Promise((resolve) => {
    const child = spawn("gh", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let error: Error | undefined;
    const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
      child.kill("SIGKILL");
      child.stdout.destroy();
      child.stderr.destroy();
    }, options.timeoutMs);

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", (spawnError) => {
      error = spawnError;
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, error });
    });
  });
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
  const versionResult = await runGithubCommand(["--version"], cwd);

  if (isGithubCliUnavailable(versionResult)) {
    throw new AppError("GitHub CLI (`gh`) is not installed");
  }

  if (versionResult.status !== 0) {
    throw new AppError(
      `GitHub CLI is unavailable: ${getGithubErrorMessage(versionResult)}`
    );
  }

  const authResult = await runGithubCommand(["auth", "status"], cwd);

  if (authResult.status !== 0) {
    throw new AppError("GitHub CLI is not authenticated. Run `gh auth login`.");
  }
}

export async function getPullRequestInfo(
  repoRoot: string,
  pullRequestNumber: string
): Promise<PullRequestInfo> {
  const result = await runGithubCommand(
    [
      "pr",
      "view",
      pullRequestNumber,
      "--json",
      "author,baseRefName,headRefName,headRefOid,number,title,url",
    ],
    repoRoot
  );

  if (result.status !== 0) {
    throw new AppError(
      `Could not load PR #${pullRequestNumber}: ${getGithubErrorMessage(result)}`
    );
  }

  let info: Partial<{
    author: { login?: string; name?: string } | null;
    baseRefName: string;
    headRefName: string;
    headRefOid: string;
    number: number;
    title: string;
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
    !info.title ||
    !info.url
  ) {
    throw new AppError(`Could not determine branch information for PR #${pullRequestNumber}`);
  }

  return {
    author: info.author?.name?.trim() || info.author?.login || "unknown",
    baseRefName: info.baseRefName,
    headRefName: info.headRefName,
    headRefOid: info.headRefOid,
    number: String(info.number),
    title: info.title,
    url: info.url,
  };
}

// A successful request establishes the access needed for this PR. Probe setup
// only after failure so installation/authentication guidance remains actionable.
export async function getReadyPullRequestInfo(
  repoRoot: string,
  pullRequestNumber: string
): Promise<PullRequestInfo> {
  try {
    return await getPullRequestInfo(repoRoot, pullRequestNumber);
  } catch (error) {
    await ensureGithubCliReady(repoRoot);
    throw error;
  }
}

export async function listPullRequestLinks(
  repoRoot: string
): Promise<Map<string, PullRequestLink>> {
  const result = await runGithubCommand(
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
  return (await queryOpenPullRequests(repoRoot)) ?? [];
}

// Keep successful empty results distinct from unavailable/invalid responses for
// callers that cache suggestions. Ordinary list callers retain their [] fallback.
export async function queryOpenPullRequests(
  repoRoot: string,
  options: { timeoutMs?: number } = {}
): Promise<OpenPullRequestSummary[] | undefined> {
  const result = await runGithubCommand(
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
    repoRoot,
    options
  );

  if (result.status !== 0) {
    return undefined;
  }

  let entries: unknown;
  try {
    entries = JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
  if (!Array.isArray(entries)) {
    return undefined;
  }

  return entries.flatMap((entry: unknown) => {
    if (
      !entry || typeof entry !== "object" ||
      !("number" in entry) || typeof entry.number !== "number" ||
      !("title" in entry) || typeof entry.title !== "string" || !entry.title ||
      !("headRefName" in entry) || typeof entry.headRefName !== "string" || !entry.headRefName
    ) {
      return [];
    }
    const author = "author" in entry && entry.author && typeof entry.author === "object" &&
      "login" in entry.author && typeof entry.author.login === "string"
      ? entry.author.login
      : "unknown";
    return [{
      author,
      headRefName: entry.headRefName,
      isDraft: "isDraft" in entry && entry.isDraft === true,
      number: String(entry.number),
      title: entry.title,
    }];
  });
}

export async function checkoutPullRequest(
  worktreePath: string,
  pullRequestNumber: string
): Promise<void> {
  const result = await runGithubCommand(["pr", "checkout", pullRequestNumber], worktreePath);

  if (result.status !== 0) {
    throw new AppError(
      `Could not check out PR #${pullRequestNumber}: ${getGithubErrorMessage(result)}`
    );
  }
}
