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

async function run(
  command: string[],
  options: { cwd?: string; capture?: boolean } = {}
): Promise<string> {
  const proc = spawn(command, {
    cwd: options.cwd,
    env: process.env,
    stdin: "inherit",
    stdout: options.capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const stdout = options.capture ? await new Response(proc.stdout).text() : "";
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

async function promptNewBranch(cwd: string): Promise<string | undefined> {
  return fzf(
    ["--phony", "--bind=enter:print-query+accept", "--prompt=New branch> "],
    "",
    cwd
  );
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

function promptLabel(mode: WtMode): string {
  if (mode === "pr") return "Pull request number";
  if (mode === "checkout") return "Local branch";
  return "New branch";
}

async function runUi(): Promise<void> {
  const context = decodeLaunchContext(requiredEnv("WT_HERDR_CONTEXT"));

  try {
    const target =
      context.mode === "new"
        ? await promptNewBranch(context.cwd)
        : await fzf(
            ["--phony", "--bind=enter:print-query+accept", `--prompt=${promptLabel(context.mode)}> `],
            "",
            context.cwd
          );
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

  throw new Error("Usage: wt-herdr launch <new|checkout|pr> | ui");
}

if (import.meta.main) {
  await main();
}
