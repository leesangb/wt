import { spawn } from "bun";
import { createInterface } from "node:readline/promises";

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
  const input = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log(`wt → Herdr (${context.mode})\n`);
    const target = (await input.question(`${promptLabel(context.mode)}: `)).trim();
    if (!target) return;

    const pluginWt = `${requiredEnv("HERDR_PLUGIN_ROOT")}/.herdr-plugin/bin/wt`;
    const output = await run([pluginWt, context.mode, target, "--json"], {
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
    await input.question("\nPress Enter to close…");
    process.exitCode = 1;
  } finally {
    input.close();
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
