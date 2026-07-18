import { spawn } from "bun";

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

  throw new Error("Usage: wt-herdr launch <new|checkout|pr> | ui | open-all");
}

if (import.meta.main) {
  await main();
}
