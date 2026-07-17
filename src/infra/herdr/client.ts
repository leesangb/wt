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

export async function openHerdrWorktree(
  path: string,
  label: string,
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
      "--focus",
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
