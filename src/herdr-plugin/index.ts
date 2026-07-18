import { spawn } from "bun";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { readWorktreeMeta } from "../infra/storage/worktree-meta-store.js";

export type WtMode = "new" | "checkout" | "pr";

interface PluginContext {
  workspace_id?: string;
  workspace_cwd?: string;
  focused_pane_cwd?: string;
}

interface LaunchContext {
  mode: WtMode;
  workspaceId: string;
  cwd: string;
}

interface WtJsonResult {
  id: string;
  path: string;
  branch: string;
}

interface BranchRef {
  name: string;
  ref: string;
  local: boolean;
}

interface PullRequest {
  number: number;
  title: string;
  author: { login: string } | null;
  headRefName: string;
  isDraft: boolean;
}

export interface PullRequestDetails {
  number: number;
  url: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  isDraft: boolean;
}

interface CheckStatus {
  bucket: "pass" | "fail" | "pending" | "skipping" | "cancel";
}

interface WorkspaceWatchTarget {
  workspaceId: string;
  cwd: string;
}

interface HerdrWorktreeList {
  result: {
    source: { source_workspace_id: string };
    worktrees: Array<{
      is_linked_worktree: boolean;
      is_prunable: boolean;
      label: string;
      open_workspace_id?: string;
      path: string;
    }>;
  };
}

const ANSI_GRAY = "\x1b[90m";
const ANSI_RESET = "\x1b[0m";
const METADATA_SOURCE = "wt:github";
const GIT_METADATA_SOURCE = "wt:git";
const METADATA_TTL_MS = 600_000;
const GIT_METADATA_TTL_MS = 600_000;
const FOCUSED_GIT_REFRESH_INTERVAL_MS = 30_000;
const BACKGROUND_GIT_REFRESH_INTERVAL_MS = 300_000;
const STABLE_REFRESH_INTERVAL_MS = 300_000;
const RETRY_INTERVAL_MS = 60_000;
const CHECK_WATCH_INTERVAL_SECONDS = 10;

interface PullRequestColumnWidths {
  number: number;
  status: number;
  title: number;
  author: number;
  branch: number;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function parsePluginContext(raw: string, mode: WtMode): LaunchContext {
  const context = JSON.parse(raw) as PluginContext;
  const workspaceId = context.workspace_id;
  const cwd = context.focused_pane_cwd ?? context.workspace_cwd;

  if (!workspaceId) throw new Error("Run this action from a Herdr workspace");
  if (!cwd) throw new Error("Could not determine the current working directory");

  return { mode, workspaceId, cwd };
}

export function encodeLaunchContext(context: LaunchContext): string {
  return Buffer.from(JSON.stringify(context), "utf8").toString("base64");
}

export function decodeLaunchContext(encoded: string): LaunchContext {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

export function parseWtJsonOutput(output: string): WtJsonResult {
  const lines = output.trim().split(/\r?\n/).reverse();

  for (const line of lines) {
    try {
      const value = JSON.parse(line) as Partial<WtJsonResult>;
      if (value.id && value.path && value.branch) {
        return value as WtJsonResult;
      }
    } catch {}
  }

  throw new Error("wt did not return a worktree JSON result");
}

export async function streamAndCaptureOutput(
  stream: ReadableStream<Uint8Array>,
  output: { write(chunk: Uint8Array): unknown }
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let captured = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    output.write(value);
    captured += decoder.decode(value, { stream: true });
  }

  return captured + decoder.decode();
}

async function run(
  command: string[],
  options: {
    cwd?: string;
    capture?: boolean;
    streamCapturedOutput?: boolean;
  } = {}
): Promise<string> {
  const proc = spawn(command, {
    cwd: options.cwd,
    env: process.env,
    stdin: "inherit",
    stdout: options.capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const stdout = options.capture
    ? options.streamCapturedOutput
      ? await streamAndCaptureOutput(
          proc.stdout as ReadableStream<Uint8Array>,
          process.stdout
        )
      : await new Response(proc.stdout).text()
    : "";
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`${command[0]} exited with code ${exitCode}`);
  }

  return stdout;
}

async function capture(command: string[], cwd: string): Promise<string> {
  const proc = spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `${command[0]} exited with code ${exitCode}`);
  }

  return stdout;
}

async function captureWithExitCodes(
  command: string[],
  cwd: string,
  acceptedExitCodes: number[]
): Promise<string> {
  const proc = spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (!acceptedExitCodes.includes(exitCode)) {
    throw new Error(stderr.trim() || `${command[0]} exited with code ${exitCode}`);
  }

  return stdout;
}

export function parsePullRequestDetails(json: string): PullRequestDetails {
  const value = JSON.parse(json) as Partial<PullRequestDetails>;

  if (
    typeof value.number !== "number" ||
    typeof value.url !== "string" ||
    !["OPEN", "MERGED", "CLOSED"].includes(value.state ?? "") ||
    typeof value.isDraft !== "boolean"
  ) {
    throw new Error("GitHub returned invalid pull request details");
  }

  return value as PullRequestDetails;
}

export function pullRequestStatusToken(pullRequest: PullRequestDetails): string {
  const indicator =
    pullRequest.state === "MERGED"
      ? "🟣"
      : pullRequest.state === "CLOSED"
        ? "🔴"
        : pullRequest.isDraft
          ? "⚪"
          : "🟢";

  return `${indicator} #${pullRequest.number}`;
}

export function ciStatusToken(json: string): string | undefined {
  const checks = JSON.parse(json) as CheckStatus[];
  if (!Array.isArray(checks) || checks.length === 0) return undefined;

  if (checks.some(({ bucket }) => bucket === "fail" || bucket === "cancel")) {
    return "❌";
  }
  if (checks.some(({ bucket }) => bucket === "pending")) {
    return "🟡";
  }
  if (checks.every(({ bucket }) => bucket === "pass" || bucket === "skipping")) {
    return "✅";
  }

  return "🟡";
}

export function gitDiffStatusToken(
  numstat: string,
  untrackedFiles: string
): string | undefined {
  let added = 0;
  let deleted = 0;
  let hasTrackedLineChanges = false;

  for (const line of numstat.split(/\r?\n/)) {
    const [addedText, deletedText] = line.split("\t", 2);
    const lineAdded = Number(addedText);
    const lineDeleted = Number(deletedText);
    if (!Number.isFinite(lineAdded) || !Number.isFinite(lineDeleted)) continue;

    added += lineAdded;
    deleted += lineDeleted;
    hasTrackedLineChanges = true;
  }

  const untracked = untrackedFiles.split("\0").filter(Boolean).length;
  const tokens: string[] = [];
  if (hasTrackedLineChanges) tokens.push(`+${added}`, `-${deleted}`);
  if (untracked > 0) tokens.push(`?${untracked}`);

  return tokens.length > 0 ? tokens.join(" ") : undefined;
}

export function gitDiffRefreshIntervalMs(focused: boolean): number {
  return focused
    ? FOCUSED_GIT_REFRESH_INTERVAL_MS
    : BACKGROUND_GIT_REFRESH_INTERVAL_MS;
}

export function parseWorktreeOpenedEvent(json: string): WorkspaceWatchTarget {
  type WorktreeOpenedEvent = {
    workspace?: {
      workspace_id?: string;
      worktree?: { checkout_path?: string };
    };
    worktree?: { path?: string };
  };
  const envelope = JSON.parse(json) as WorktreeOpenedEvent & {
    event?: string | WorktreeOpenedEvent;
    data?: WorktreeOpenedEvent;
  };
  const event =
    typeof envelope.event === "object"
      ? envelope.event
      : envelope.data ?? envelope;
  const workspaceId = event.workspace?.workspace_id;
  const cwd = event.worktree?.path ?? event.workspace?.worktree?.checkout_path;

  if (!workspaceId || !cwd) {
    throw new Error("Herdr worktree event is missing workspace context");
  }

  return { workspaceId, cwd };
}

export function parseWorkspaceFocusedEvent(json: string): string {
  const envelope = JSON.parse(json) as {
    workspace_id?: string;
    event?: string | { workspace_id?: string };
    data?: { workspace_id?: string };
  };
  const workspaceId =
    (typeof envelope.event === "object"
      ? envelope.event.workspace_id
      : envelope.data?.workspace_id) ?? envelope.workspace_id;

  if (!workspaceId) {
    throw new Error("Herdr workspace event is missing a workspace id");
  }

  return workspaceId;
}

export function buildBaseBranchChoices(refs: string): BranchRef[] {
  const choices = new Map<string, BranchRef>();

  for (const line of refs.split(/\r?\n/)) {
    const ref = line.trim();
    if (!ref || ref.endsWith("/HEAD")) continue;

    const local = !ref.startsWith("origin/");
    const name = local ? ref : ref.slice("origin/".length);
    const existing = choices.get(name);

    if (!existing || local) {
      choices.set(name, { name, ref, local });
    }
  }

  return [...choices.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function fitColumn(value: string, width: number): string {
  if (Bun.stringWidth(value) <= width) {
    return value + " ".repeat(width - Bun.stringWidth(value));
  }

  let result = "";
  for (const character of value) {
    if (Bun.stringWidth(`${result}${character}…`) > width) break;
    result += character;
  }

  const truncated = `${result}…`;
  return truncated + " ".repeat(Math.max(0, width - Bun.stringWidth(truncated)));
}

function pullRequestColumnWidths(terminalWidth: number): PullRequestColumnWidths {
  const number = 8;
  const status = 8;
  const author = 18;
  const branch = Math.max(20, Math.min(32, Math.floor(terminalWidth * 0.25)));
  const gaps = 8;
  const title = Math.max(
    24,
    terminalWidth - number - status - author - branch - gaps
  );

  return { number, status, title, author, branch };
}

function formatPullRequestColumns(
  values: Record<keyof PullRequestColumnWidths, string>,
  widths: PullRequestColumnWidths
): string {
  return (
    Object.keys(widths) as Array<keyof PullRequestColumnWidths>
  )
    .map((key) => fitColumn(values[key], widths[key]))
    .join("  ");
}

export function buildPullRequestHeader(terminalWidth: number = 120): string {
  return formatPullRequestColumns(
    {
      number: "PR",
      status: "Status",
      title: "Title",
      author: "Author",
      branch: "Branch",
    },
    pullRequestColumnWidths(terminalWidth)
  ).trimEnd();
}

export function buildPullRequestChoices(
  json: string,
  terminalWidth: number = 120
): string[] {
  const pullRequests = JSON.parse(json) as PullRequest[];
  const widths = pullRequestColumnWidths(terminalWidth);

  return pullRequests.map((pullRequest) => {
    const title = pullRequest.title.replaceAll("\t", " ");
    const author = pullRequest.author?.login ?? "unknown";
    const status = pullRequest.isDraft ? "Draft" : "";
    const plainDisplay = formatPullRequestColumns(
      {
        number: `#${pullRequest.number}`,
        status,
        title,
        author: `@${author}`,
        branch: pullRequest.headRefName,
      },
      widths
    );
    const display = pullRequest.isDraft
      ? plainDisplay.replace(
          fitColumn(status, widths.status),
          `${ANSI_GRAY}${fitColumn(status, widths.status)}${ANSI_RESET}`
        )
      : plainDisplay;

    return `${display}\t${pullRequest.number}`;
  });
}

export function closedLinkedWorktrees(json: string): Array<{
  label: string;
  path: string;
}> {
  const response = JSON.parse(json) as HerdrWorktreeList;

  return response.result.worktrees
    .filter(
      (worktree) =>
        worktree.is_linked_worktree &&
        !worktree.is_prunable &&
        !worktree.open_workspace_id
    )
    .map(({ label, path }) => ({ label, path }));
}

async function fzf(
  args: string[],
  input: string,
  cwd: string
): Promise<string | undefined> {
  const proc = spawn(["fzf", ...args], {
    cwd,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  proc.stdin.write(input);
  proc.stdin.end();

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode === 130 || exitCode === 1) return undefined;
  if (exitCode !== 0) throw new Error(`fzf exited with code ${exitCode}`);
  return output.trim();
}

async function promptNewBranch(): Promise<string | undefined> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error("New branch input requires an interactive terminal");
  }

  return new Promise((resolve) => {
    let value = "";
    const render = () => {
      process.stdout.write(`\r\x1b[2KNew branch> ${value}`);
    };
    const finish = (result: string | undefined) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf8");

      if (text === "\x1b" || text === "\x03") {
        finish(undefined);
        return;
      }
      if (text === "\r" || text === "\n") {
        finish(value.trim() || undefined);
        return;
      }
      if (text === "\x7f" || text === "\b") {
        value = [...value].slice(0, -1).join("");
        render();
        return;
      }
      if (!text.startsWith("\x1b") && !/[\u0000-\u001f]/.test(text)) {
        value += text;
        render();
      }
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
    render();
  });
}

async function pickBaseBranch(cwd: string): Promise<string | undefined> {
  const refs = await capture(
    [
      "git",
      "for-each-ref",
      "--format=%(refname:short)",
      "refs/heads",
      "refs/remotes/origin",
    ],
    cwd
  );
  const choices = buildBaseBranchChoices(refs);
  const selected = await fzf(
    [
      "--delimiter=\t",
      "--with-nth=1",
      "--prompt=Base branch> ",
      "--header=Enter: select · Esc: cancel",
    ],
    choices.map(({ name, ref }) => `${name}\t${ref}`).join("\n"),
    cwd
  );

  return selected?.split("\t")[1];
}

async function pickLocalBranch(cwd: string): Promise<string | undefined> {
  const refs = await capture(
    ["git", "for-each-ref", "--format=%(refname:short)", "refs/heads"],
    cwd
  );

  return fzf(
    [
      "--prompt=Local branch> ",
      "--header=Enter: select · Esc: cancel",
    ],
    refs.trim(),
    cwd
  );
}

async function pickPullRequest(cwd: string): Promise<string | undefined> {
  const json = await capture(
    [
      "gh",
      "pr",
      "list",
      "--state",
      "open",
      "--limit",
      "100",
      "--json",
      "number,title,author,headRefName,isDraft",
    ],
    cwd
  );
  const terminalWidth = process.stdout.columns || 120;
  const choices = buildPullRequestChoices(json, terminalWidth);

  if (choices.length === 0) {
    throw new Error("No open pull requests found");
  }

  const selected = await fzf(
    [
      "--delimiter=\t",
      "--with-nth=1",
      "--ansi",
      "--prompt=Pull request> ",
      `--header=${buildPullRequestHeader(terminalWidth)}\nEsc: cancel`,
    ],
    choices.join("\n"),
    cwd
  );

  return selected?.split("\t").at(-1);
}

async function launch(mode: WtMode): Promise<void> {
  const context = parsePluginContext(
    requiredEnv("HERDR_PLUGIN_CONTEXT_JSON"),
    mode
  );
  const encoded = encodeLaunchContext(context);
  const herdr = process.env.HERDR_BIN_PATH ?? "herdr";

  await run([
    herdr,
    "plugin",
    "pane",
    "open",
    "--plugin",
    "wt.herdr",
    "--entrypoint",
    "create",
    "--placement",
    "overlay",
    "--env",
    `WT_HERDR_CONTEXT=${encoded}`,
    "--focus",
  ]);
}

async function openAll(): Promise<void> {
  const context = parsePluginContext(
    requiredEnv("HERDR_PLUGIN_CONTEXT_JSON"),
    "checkout"
  );
  const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
  const listOutput = await run(
    [
      herdr,
      "worktree",
      "list",
      "--workspace",
      context.workspaceId,
      "--json",
    ],
    { capture: true }
  );
  const worktrees = closedLinkedWorktrees(listOutput);

  for (const worktree of worktrees) {
    await run([
      herdr,
      "worktree",
      "open",
      "--workspace",
      context.workspaceId,
      "--path",
      worktree.path,
      "--label",
      worktree.label,
      "--no-focus",
      "--json",
    ]);
  }

  const body =
    worktrees.length === 0
      ? "All existing worktrees are already open"
      : `Opened ${worktrees.length} existing worktree${worktrees.length === 1 ? "" : "s"}`;
  await run([herdr, "notification", "show", "wt", "--body", body]);
}

async function loadPullRequestDetails(cwd: string): Promise<PullRequestDetails> {
  const meta = await readWorktreeMeta(cwd);
  const args = ["gh", "pr", "view"];
  if (meta?.prNumber) args.push(meta.prNumber);
  args.push("--json", "number,url,state,isDraft");

  return parsePullRequestDetails(await capture(args, cwd));
}

async function loadCiStatus(
  pullRequest: PullRequestDetails,
  cwd: string
): Promise<string | undefined> {
  const json = await captureWithExitCodes(
    [
      "gh",
      "pr",
      "checks",
      String(pullRequest.number),
      "--json",
      "bucket",
    ],
    cwd,
    [0, 8]
  );

  return ciStatusToken(json);
}

async function reportPullRequestStatus(
  target: WorkspaceWatchTarget,
  pullRequest: PullRequestDetails,
  ci: string | undefined | null
): Promise<void> {
  const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
  const args = [
    herdr,
    "workspace",
    "report-metadata",
    target.workspaceId,
    "--source",
    METADATA_SOURCE,
    "--token",
    `pr=${pullRequestStatusToken(pullRequest)}`,
    "--seq",
    String(Date.now()),
    "--ttl-ms",
    String(METADATA_TTL_MS),
  ];
  if (ci !== null) {
    args.push(ci ? "--token" : "--clear-token", ci ? `ci=${ci}` : "ci");
  }

  await captureWithExitCodes(args, target.cwd, [0]);
}

async function loadGitDiffStatus(cwd: string): Promise<string | undefined> {
  const [numstat, untrackedFiles] = await Promise.all([
    capture(["git", "diff", "--numstat", "HEAD", "--"], cwd),
    capture(
      ["git", "ls-files", "--others", "--exclude-standard", "-z"],
      cwd
    ),
  ]);

  return gitDiffStatusToken(numstat, untrackedFiles);
}

async function reportGitDiffStatus(
  target: WorkspaceWatchTarget,
  status: string | undefined
): Promise<void> {
  const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
  const args = [
    herdr,
    "workspace",
    "report-metadata",
    target.workspaceId,
    "--source",
    GIT_METADATA_SOURCE,
    status ? "--token" : "--clear-token",
    status ? `diff=${status}` : "diff",
    "--seq",
    String(Date.now()),
    "--ttl-ms",
    String(GIT_METADATA_TTL_MS),
  ];

  await captureWithExitCodes(args, target.cwd, [0]);
}

async function refreshGitDiffStatus(
  target: WorkspaceWatchTarget
): Promise<void> {
  await reportGitDiffStatus(target, await loadGitDiffStatus(target.cwd));
}

async function loadWorkspaceState(
  target: WorkspaceWatchTarget
): Promise<{ focused: boolean } | undefined> {
  const herdr = process.env.HERDR_BIN_PATH ?? "herdr";

  try {
    const json = await captureWithExitCodes(
      [herdr, "workspace", "get", target.workspaceId],
      target.cwd,
      [0]
    );
    const response = JSON.parse(json) as {
      result?: { workspace?: { workspace_id?: string; focused?: boolean } };
    };
    const workspace = response.result?.workspace;

    return workspace?.workspace_id
      ? { focused: workspace.focused === true }
      : undefined;
  } catch {
    return undefined;
  }
}

async function workspaceExists(target: WorkspaceWatchTarget): Promise<boolean> {
  return (await loadWorkspaceState(target)) !== undefined;
}

async function loadWorkspaceTarget(
  workspaceId: string
): Promise<WorkspaceWatchTarget | undefined> {
  const herdr = process.env.HERDR_BIN_PATH ?? "herdr";
  const json = await captureWithExitCodes(
    [herdr, "workspace", "get", workspaceId],
    process.cwd(),
    [0]
  );
  const response = JSON.parse(json) as {
    result?: {
      workspace?: {
        workspace_id?: string;
        worktree?: { checkout_path?: string };
      };
    };
  };
  const workspace = response.result?.workspace;

  if (!workspace?.workspace_id || !workspace.worktree?.checkout_path) {
    return undefined;
  }

  return {
    workspaceId: workspace.workspace_id,
    cwd: workspace.worktree.checkout_path,
  };
}

function watcherLockPath(workspaceId: string, watcher: string): string {
  const stateDir = requiredEnv("HERDR_PLUGIN_STATE_DIR");
  mkdirSync(stateDir, { recursive: true });
  return join(
    stateDir,
    `${watcher}-${workspaceId.replaceAll(/[^A-Za-z0-9_-]/g, "-")}.pid`
  );
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireWatcherLock(
  workspaceId: string,
  watcher: string
): (() => void) | undefined {
  const lockPath = watcherLockPath(workspaceId, watcher);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      writeFileSync(fd, String(process.pid));
      closeSync(fd);

      return () => {
        try {
          if (readFileSync(lockPath, "utf8").trim() === String(process.pid)) {
            unlinkSync(lockPath);
          }
        } catch {}
      };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;

      try {
        const existingPid = Number(readFileSync(lockPath, "utf8").trim());
        if (Number.isInteger(existingPid) && processIsRunning(existingPid)) {
          return undefined;
        }
        unlinkSync(lockPath);
      } catch {
        try {
          unlinkSync(lockPath);
        } catch {}
      }
    }
  }

  return undefined;
}

async function refreshPullRequestStatus(
  target: WorkspaceWatchTarget
): Promise<{ pullRequest: PullRequestDetails; ci: string | undefined | null }> {
  const pullRequest = await loadPullRequestDetails(target.cwd);
  let ci: string | undefined | null;

  try {
    ci = await loadCiStatus(pullRequest, target.cwd);
  } catch {
    // Keep the existing CI token until its TTL expires after a transient request failure.
    ci = null;
  }

  await reportPullRequestStatus(target, pullRequest, ci);
  return { pullRequest, ci };
}

async function waitForPendingChecks(
  pullRequest: PullRequestDetails,
  cwd: string
): Promise<void> {
  await captureWithExitCodes(
    [
      "gh",
      "pr",
      "checks",
      String(pullRequest.number),
      "--watch",
      "--interval",
      String(CHECK_WATCH_INTERVAL_SECONDS),
      "--json",
      "bucket",
    ],
    cwd,
    [0, 1]
  );
}

async function watchPullRequestStatus(target: WorkspaceWatchTarget): Promise<void> {
  const releaseLock = acquireWatcherLock(target.workspaceId, "github-status");
  if (!releaseLock) return;

  const stop = () => {
    releaseLock();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let consecutiveFailures = 0;

  try {
    while (await workspaceExists(target)) {
      try {
        const status = await refreshPullRequestStatus(target);
        consecutiveFailures = 0;
        if (status.ci === "🟡") {
          try {
            await waitForPendingChecks(status.pullRequest, target.cwd);
          } catch {}
          continue;
        }
        await Bun.sleep(STABLE_REFRESH_INTERVAL_MS);
      } catch {
        // Metadata has a TTL, so stale GitHub data disappears during outages.
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) break;
        await Bun.sleep(RETRY_INTERVAL_MS);
      }
    }
  } finally {
    releaseLock();
  }
}

async function watchGitDiffStatus(
  target: WorkspaceWatchTarget,
  lastRefreshAt = 0
): Promise<void> {
  const releaseLock = acquireWatcherLock(target.workspaceId, "git-diff");
  if (!releaseLock) return;

  const stop = () => {
    releaseLock();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  let consecutiveFailures = 0;

  try {
    while (true) {
      const workspace = await loadWorkspaceState(target);
      if (!workspace) break;

      const now = Date.now();
      if (
        lastRefreshAt === 0 ||
        now - lastRefreshAt >= gitDiffRefreshIntervalMs(workspace.focused)
      ) {
        try {
          await refreshGitDiffStatus(target);
          lastRefreshAt = Date.now();
          consecutiveFailures = 0;
        } catch {
          consecutiveFailures += 1;
          if (consecutiveFailures >= 3) break;
        }
      }
      await Bun.sleep(FOCUSED_GIT_REFRESH_INTERVAL_MS);
    }
  } finally {
    releaseLock();
  }
}

async function watchWorkspaceStatus(
  target: WorkspaceWatchTarget,
  gitLastRefreshAt = 0
): Promise<void> {
  await Promise.all([
    watchGitDiffStatus(target, gitLastRefreshAt),
    watchPullRequestStatus(target).catch(() => {
      // Git status remains useful for branches without a pull request.
    }),
  ]);
}

async function watchEvent(): Promise<void> {
  await watchWorkspaceStatus(
    parseWorktreeOpenedEvent(requiredEnv("HERDR_PLUGIN_EVENT_JSON"))
  );
}

async function watchContext(): Promise<void> {
  const context = parsePluginContext(
    requiredEnv("HERDR_PLUGIN_CONTEXT_JSON"),
    "pr"
  );
  await watchWorkspaceStatus({
    workspaceId: context.workspaceId,
    cwd: context.cwd,
  });
}

async function refreshFocusedWorkspace(): Promise<void> {
  const workspaceId = parseWorkspaceFocusedEvent(
    requiredEnv("HERDR_PLUGIN_EVENT_JSON")
  );
  const target = await loadWorkspaceTarget(workspaceId);
  if (!target) return;

  await refreshGitDiffStatus(target);
  const gitRefreshedAt = Date.now();
  try {
    await refreshPullRequestStatus(target);
  } catch {
    // Spaces without a linked pull request still report Git changes.
  }
  await watchWorkspaceStatus(target, gitRefreshedAt);
}

async function openPullRequest(): Promise<void> {
  const context = parsePluginContext(
    requiredEnv("HERDR_PLUGIN_CONTEXT_JSON"),
    "pr"
  );
  const pullRequest = await loadPullRequestDetails(context.cwd);

  await run(
    ["gh", "pr", "view", String(pullRequest.number), "--web"],
    { cwd: context.cwd }
  );
}

async function runUi(): Promise<void> {
  const context = decodeLaunchContext(requiredEnv("WT_HERDR_CONTEXT"));

  try {
    const target =
      context.mode === "new"
        ? await promptNewBranch()
        : context.mode === "checkout"
          ? await pickLocalBranch(context.cwd)
          : await pickPullRequest(context.cwd);
    if (!target) return;

    const pluginWt = `${requiredEnv("HERDR_PLUGIN_ROOT")}/.herdr-plugin/bin/wt`;
    const wtArgs = [pluginWt, context.mode, target];

    if (context.mode === "new") {
      const base = await pickBaseBranch(context.cwd);
      if (!base) return;
      wtArgs.push("--base", base);
    }

    wtArgs.push("--json");
    const output = await run(wtArgs, {
      cwd: context.cwd,
      capture: true,
      streamCapturedOutput: true,
    });
    const result = parseWtJsonOutput(output);
    const herdr = process.env.HERDR_BIN_PATH ?? "herdr";

    await run([
      herdr,
      "worktree",
      "open",
      "--workspace",
      context.workspaceId,
      "--path",
      result.path,
      "--label",
      result.id,
      "--focus",
      "--json",
    ]);
  } catch (error) {
    console.error(`\n${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  const [command, mode] = process.argv.slice(2);

  if (command === "launch" && ["new", "checkout", "pr"].includes(mode ?? "")) {
    await launch(mode as WtMode);
    return;
  }
  if (command === "ui") {
    await runUi();
    return;
  }
  if (command === "open-all") {
    await openAll();
    return;
  }
  if (command === "watch-event") {
    await watchEvent();
    return;
  }
  if (command === "watch-context") {
    await watchContext();
    return;
  }
  if (command === "refresh-focused") {
    await refreshFocusedWorkspace();
    return;
  }
  if (command === "open-pr") {
    await openPullRequest();
    return;
  }

  throw new Error(
    "Usage: wt-herdr launch <new|checkout|pr> | ui | open-all | watch-event | watch-context | refresh-focused | open-pr"
  );
}

if (import.meta.main) {
  await main();
}
