import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";

export interface DetachedScriptOptions {
  statusFilePath: string;
  logFilePath: string;
  scripts: string[];
}

export function shellEscapeSingle(value: string): string {
  return value.replace(/'/g, `'"'"'`);
}

export function buildDetachedRunnerCommand(options: DetachedScriptOptions): string {
  const statusFile = shellEscapeSingle(options.statusFilePath);
  const logFile = shellEscapeSingle(options.logFilePath);

  const scriptBody = options.scripts.map(s => `  ${s}`).join("\n");

  return `(
set -e
{
${scriptBody}
} >> '${logFile}' 2>&1
printf '{"status":"done","finishedAt":"%s"}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > '${statusFile}'
) || {
printf '{"status":"failed","finishedAt":"%s"}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > '${statusFile}'
}`;
}

export async function executeScript(script: string, cwd: string, env?: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(["sh", "-c", script], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });

  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Script exited with code ${exitCode}`);
  }
}

export async function executeScripts(scripts: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  for (const script of scripts) {
    await executeScript(script, cwd, env);
  }
}

export function executeScriptsDetached(scripts: string[], cwd: string, env: Record<string, string> | undefined, statusFilePath: string, logFilePath: string): number {
  mkdirSync(dirname(statusFilePath), { recursive: true });
  mkdirSync(dirname(logFilePath), { recursive: true });

  writeFileSync(
    statusFilePath,
    JSON.stringify({
      status: "running",
      startedAt: new Date().toISOString(),
      logFilePath,
      scripts,
    }, null, 2)
  );

  const command = buildDetachedRunnerCommand({
    statusFilePath,
    logFilePath,
    scripts,
  });

  const proc = Bun.spawn(["sh", "-c", command], {
    cwd,
    env: { ...process.env, ...env },
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
    detached: true,
  });

  const pid = proc.pid;
  proc.unref();

  writeFileSync(
    statusFilePath,
    JSON.stringify({
      status: "running",
      startedAt: new Date().toISOString(),
      pid,
      logFilePath,
      scripts,
    }, null, 2)
  );

  return pid;
}
