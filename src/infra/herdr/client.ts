import { spawn } from "bun";
import { realpathSync } from "fs";
import { resolve } from "path";

export interface HerdrEnvironment {
  [key: string]: string | undefined;
  HERDR_BIN_PATH?: string;
  HERDR_ENV?: string;
  HERDR_WORKSPACE_ID?: string;
}

export interface OpenHerdrWorktreeResult {
  attempted: boolean;
  opened: boolean;
  error?: string;
}

export interface OpenHerdrWorktreeOptions {
  focus?: boolean;
}

export interface FindHerdrWorkspaceResult {
  attempted: boolean;
  workspaceId?: string;
  error?: string;
}

export interface CloseHerdrWorkspaceResult {
  attempted: boolean;
  closed: boolean;
  error?: string;
}

export interface InstallHerdrPluginResult {
  installed: boolean;
  error?: string;
}

export interface HerdrPluginSyncResult {
  status:
    | "updated"
    | "up-to-date"
    | "not-installed"
    | "unavailable"
    | "skipped-linked"
    | "skipped-foreign"
    | "failed";
  version?: string;
  warning?: string;
}

export interface SyncHerdrPluginOptions {
  force?: boolean;
}

function isHerdrEnvironment(
  env: HerdrEnvironment
): env is HerdrEnvironment & { HERDR_WORKSPACE_ID: string } {
  return env.HERDR_ENV === "1" && Boolean(env.HERDR_WORKSPACE_ID);
}

function normalizePath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

export async function installHerdrPlugin(
  repository: string,
  env: HerdrEnvironment = process.env
): Promise<InstallHerdrPluginResult> {
  try {
    const herdr = env.HERDR_BIN_PATH ?? "herdr";
    const proc = spawn([herdr, "plugin", "install", repository], {
      env,
      stdout: "inherit",
      stderr: "inherit",
    });
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      return { installed: true };
    }

    return {
      installed: false,
      error: `herdr exited with code ${exitCode}`,
    };
  } catch (error) {
    return {
      installed: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function syncInstalledWtHerdrPlugin(
  version: string,
  options: SyncHerdrPluginOptions = {},
  env: HerdrEnvironment = process.env
): Promise<HerdrPluginSyncResult> {
  const herdr = env.HERDR_BIN_PATH ?? "herdr";
  const normalizedVersion = version.replace(/^v/, "");
  const ref = `v${normalizedVersion}`;

  try {
    const listProc = spawn(
      [herdr, "plugin", "list", "--plugin", "wt.herdr", "--json"],
      { env, stdout: "pipe", stderr: "pipe" }
    );
    const [stdout, stderr, listExitCode] = await Promise.all([
      new Response(listProc.stdout).text(),
      new Response(listProc.stderr).text(),
      listProc.exited,
    ]);

    if (listExitCode !== 0) {
      return {
        status: "failed",
        warning:
          stderr.trim() || `herdr plugin list exited with code ${listExitCode}`,
      };
    }

    const response = JSON.parse(stdout) as {
      result?: {
        plugins?: Array<{
          plugin_id?: string;
          source?: {
            kind?: string;
            owner?: string;
            repo?: string;
            requested_ref?: string;
          };
        }>;
      };
    };
    const plugin = response.result?.plugins?.find(
      ({ plugin_id }) => plugin_id === "wt.herdr"
    );

    if (!plugin) {
      return { status: "not-installed" };
    }

    if (!plugin.source || plugin.source.kind !== "github") {
      return {
        status: "skipped-linked",
        warning: "The wt Herdr plugin is locally linked; leaving it unchanged.",
      };
    }

    if (plugin.source.owner !== "leesangb" || plugin.source.repo !== "wt") {
      return {
        status: "skipped-foreign",
        warning: "The installed wt.herdr plugin comes from a different repository; leaving it unchanged.",
      };
    }

    if (plugin.source.requested_ref === ref && !options.force) {
      return { status: "up-to-date", version: normalizedVersion };
    }

    const installProc = spawn(
      [
        herdr,
        "plugin",
        "install",
        "leesangb/wt",
        "--ref",
        ref,
        "--yes",
      ],
      { env, stdout: "pipe", stderr: "pipe" }
    );
    const [, installStderr, installExitCode] = await Promise.all([
      new Response(installProc.stdout).text(),
      new Response(installProc.stderr).text(),
      installProc.exited,
    ]);

    if (installExitCode !== 0) {
      return {
        status: "failed",
        warning:
          installStderr.trim() ||
          `herdr plugin install exited with code ${installExitCode}`,
      };
    }

    return { status: "updated", version: normalizedVersion };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return { status: "unavailable" };
    }

    return {
      status: "failed",
      warning: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function openHerdrWorktree(
  path: string,
  label: string,
  options: OpenHerdrWorktreeOptions = {},
  env: HerdrEnvironment = process.env
): Promise<OpenHerdrWorktreeResult> {
  if (!isHerdrEnvironment(env)) {
    return { attempted: false, opened: false };
  }

  const herdr = env.HERDR_BIN_PATH ?? "herdr";
  const proc = spawn(
    [
      herdr,
      "worktree",
      "open",
      "--workspace",
      env.HERDR_WORKSPACE_ID,
      "--path",
      path,
      "--label",
      label,
      options.focus === false ? "--no-focus" : "--focus",
      "--json",
    ],
    { stdout: "pipe", stderr: "pipe" }
  );
  const [, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return {
      attempted: true,
      opened: false,
      error: stderr.trim() || `herdr exited with code ${exitCode}`,
    };
  }

  return { attempted: true, opened: true };
}

export async function findHerdrWorkspaceForWorktree(
  path: string,
  env: HerdrEnvironment = process.env
): Promise<FindHerdrWorkspaceResult> {
  if (!isHerdrEnvironment(env)) {
    return { attempted: false };
  }

  const herdr = env.HERDR_BIN_PATH ?? "herdr";
  const proc = spawn([herdr, "worktree", "list", "--cwd", path, "--json"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return {
      attempted: true,
      error: stderr.trim() || `herdr exited with code ${exitCode}`,
    };
  }

  try {
    const response = JSON.parse(stdout) as {
      result?: {
        worktrees?: Array<{ path?: string; open_workspace_id?: string }>;
      };
    };
    const normalizedPath = normalizePath(path);
    const workspaceId = response.result?.worktrees?.find(
      (worktree) =>
        worktree.path && normalizePath(worktree.path) === normalizedPath
    )?.open_workspace_id;

    return { attempted: true, ...(workspaceId ? { workspaceId } : {}) };
  } catch {
    return { attempted: true, error: "herdr returned invalid JSON" };
  }
}

export async function closeHerdrWorkspace(
  workspaceId: string | undefined,
  env: HerdrEnvironment = process.env
): Promise<CloseHerdrWorkspaceResult> {
  if (!workspaceId || !isHerdrEnvironment(env)) {
    return { attempted: false, closed: false };
  }

  const herdr = env.HERDR_BIN_PATH ?? "herdr";
  const proc = spawn([herdr, "workspace", "close", workspaceId], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    return {
      attempted: true,
      closed: false,
      error: stderr.trim() || `herdr exited with code ${exitCode}`,
    };
  }

  return { attempted: true, closed: true };
}
