import { spawn } from "bun";

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

export async function openHerdrWorktree(
  path: string,
  label: string,
  env: HerdrEnvironment = process.env
): Promise<OpenHerdrWorktreeResult> {
  if (env.HERDR_ENV !== "1" || !env.HERDR_WORKSPACE_ID) {
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
