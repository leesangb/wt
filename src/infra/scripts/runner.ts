import { spawn as spawnChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "fs";
import { dirname } from "path";
import { SHELL_CD_FILE_ENV } from "../shell/cd.js";

export interface DetachedScriptOptions {
  statusFilePath: string;
  logFilePath: string;
  scripts: string[];
  startNotification?: DetachedNotification;
  completionNotification?: DetachedCompletionNotification;
}

export interface DetachedNotification {
  title: string;
  message: string;
  subtitle?: string;
}

export interface DetachedCompletionNotification {
  title: string;
  successMessage: string;
  successSubtitle?: string;
  failureMessage: string;
  failureSubtitle?: string;
}

export function shellEscapeSingle(value: string): string {
  return value.replace(/'/g, `'"'"'`);
}

export function escapeAppleScriptString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function buildMacOsNotificationCommand(
  message: string,
  title: string,
  subtitle?: string
): string {
  const titleLiteral = escapeAppleScriptString(title);
  const messageLiteral = escapeAppleScriptString(message);
  const subtitleClause = subtitle
    ? ` subtitle "${escapeAppleScriptString(subtitle)}"`
    : "";

  return `osascript -e '${shellEscapeSingle(
    `display notification "${messageLiteral}" with title "${titleLiteral}"${subtitleClause}`
  )}' >/dev/null 2>&1 || true`;
}

export function buildPostScriptStartNotification(
  target: string
): DetachedNotification {
  return {
    title: "wt",
    message: `${target} setup started`,
    subtitle: "Post scripts running",
  };
}

export function buildPostScriptCompletionNotification(
  target: string
): DetachedCompletionNotification {
  return {
    title: "wt",
    successMessage: `${target} setup finished`,
    successSubtitle: "Post scripts completed",
    failureMessage: `${target} setup failed`,
    failureSubtitle: "Post scripts failed",
  };
}

export function buildDetachedRunnerCommand(
  options: DetachedScriptOptions
): string {
  const statusFile = shellEscapeSingle(options.statusFilePath);
  const logFile = shellEscapeSingle(options.logFilePath);
  const scriptBody = options.scripts.map((script) => `  ${script}`).join("\n");
  const startNotification = options.startNotification
    ? buildMacOsNotificationCommand(
        options.startNotification.message,
        options.startNotification.title,
        options.startNotification.subtitle
      )
    : undefined;
  const successNotification = options.completionNotification
    ? buildMacOsNotificationCommand(
        options.completionNotification.successMessage,
        options.completionNotification.title,
        options.completionNotification.successSubtitle
      )
    : undefined;
  const failureNotification = options.completionNotification
    ? buildMacOsNotificationCommand(
        options.completionNotification.failureMessage,
        options.completionNotification.title,
        options.completionNotification.failureSubtitle
      )
    : undefined;
  const successCommands = [
    successNotification,
    `printf '{"status":"done","finishedAt":"%s"}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > '${statusFile}'`,
  ]
    .filter((command): command is string => Boolean(command))
    .join("\n");
  const failureCommands = [
    failureNotification,
    `printf '{"status":"failed","finishedAt":"%s"}\n' "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" > '${statusFile}'`,
  ]
    .filter((command): command is string => Boolean(command))
    .join("\n");
  const runnerPrologue = startNotification ? `${startNotification}\n` : "";

  return `(
set -e
${runnerPrologue}
{
${scriptBody}
} >> '${logFile}' 2>&1
${successCommands}
) || {
${failureCommands}
}`;
}

export function buildScriptEnv(
  env?: Record<string, string>
): Record<string, string | undefined> {
  const scriptEnv: Record<string, string | undefined> = {
    ...process.env,
    ...env,
  };

  delete scriptEnv[SHELL_CD_FILE_ENV];

  return scriptEnv;
}

export async function executeScript(
  script: string,
  cwd: string,
  env?: Record<string, string>
): Promise<void> {
  const proc = Bun.spawn(["sh", "-c", script], {
    cwd,
    env: buildScriptEnv(env),
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Script exited with code ${exitCode}`);
  }
}

export async function executeScripts(
  scripts: string[],
  cwd: string,
  env?: Record<string, string>
): Promise<void> {
  for (const script of scripts) {
    await executeScript(script, cwd, env);
  }
}

export function executeScriptsDetached(
  scripts: string[],
  cwd: string,
  env: Record<string, string> | undefined,
  statusFilePath: string,
  logFilePath: string
): number {
  mkdirSync(dirname(statusFilePath), { recursive: true });
  mkdirSync(dirname(logFilePath), { recursive: true });
  const target = env?.WT_BRANCH ?? env?.WT_ID ?? "Worktree";
  const startNotification =
    process.platform === "darwin"
      ? buildPostScriptStartNotification(target)
      : undefined;
  const completionNotification =
    process.platform === "darwin"
      ? buildPostScriptCompletionNotification(target)
      : undefined;

  writeFileSync(
    statusFilePath,
    JSON.stringify(
      {
        status: "running",
        startedAt: new Date().toISOString(),
        logFilePath,
        scripts,
      },
      null,
      2
    )
  );

  const proc = spawnChildProcess(
    "sh",
    [
      "-c",
      buildDetachedRunnerCommand({
        scripts,
        statusFilePath,
        logFilePath,
        startNotification,
        completionNotification,
      }),
    ],
    {
      cwd,
      env: buildScriptEnv(env),
      detached: true,
      stdio: "ignore",
    }
  );
  const pid = proc.pid;
  if (pid === undefined) {
    throw new Error("Failed to start detached script process");
  }
  proc.unref();

  writeFileSync(
    statusFilePath,
    JSON.stringify(
      {
        status: "running",
        startedAt: new Date().toISOString(),
        pid,
        logFilePath,
        scripts,
      },
      null,
      2
    )
  );

  return pid;
}
