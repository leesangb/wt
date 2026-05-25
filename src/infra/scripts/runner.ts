import { spawn as spawnChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import { SHELL_CD_FILE_ENV } from "../shell/cd.js";

export interface DetachedScriptOptions {
  statusFilePath: string;
  logFilePath: string;
  scripts: string[];
  startNotification?: DetachedNotification;
  completionNotification?: DetachedCompletionNotification;
}

export interface DetachedTaskOptions extends DetachedScriptOptions {
  cwd: string;
  env?: Record<string, string>;
  statusMetadata?: Record<string, unknown>;
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
  const buildStatusUpdateCommand = (status: "done" | "failed"): string => [
    `tmp_status_file='${statusFile}'.tmp.$$`,
    `finished_at=$(date -u +"%Y-%m-%dT%H:%M:%SZ")`,
    `if [ -f '${statusFile}' ]; then`,
    `  sed -e 's/"status"[[:space:]]*:[[:space:]]*"running"/"status": "${status}"/' -e '$ s/}/,\\n  "finishedAt": "'"$finished_at"'"\\n}/' '${statusFile}' > "$tmp_status_file"`,
    `else`,
    `  printf '{"status":"${status}","finishedAt":"%s"}\n' "$finished_at" > "$tmp_status_file"`,
    `fi`,
    `mv "$tmp_status_file" '${statusFile}'`,
  ].join("\n");
  const successCommands = [
    buildStatusUpdateCommand("done"),
    successNotification,
  ]
    .filter((command): command is string => Boolean(command))
    .join("\n");
  const failureCommands = [
    buildStatusUpdateCommand("failed"),
    failureNotification,
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
  const target = env?.WT_BRANCH ?? env?.WT_ID ?? "Worktree";
  const startNotification =
    process.platform === "darwin"
      ? buildPostScriptStartNotification(target)
      : undefined;
  const completionNotification =
    process.platform === "darwin"
      ? buildPostScriptCompletionNotification(target)
      : undefined;

  return executeDetachedTask({
    scripts,
    cwd,
    env,
    statusFilePath,
    logFilePath,
    startNotification,
    completionNotification,
  });
}

export function executeDetachedTask(options: DetachedTaskOptions): number {
  const {
    cwd,
    env,
    logFilePath,
    scripts,
    statusFilePath,
    statusMetadata,
    startNotification,
    completionNotification,
  } = options;

  mkdirSync(dirname(statusFilePath), { recursive: true });
  mkdirSync(dirname(logFilePath), { recursive: true });

  writeFileSync(
    statusFilePath,
    JSON.stringify(
      {
        ...statusMetadata,
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

  tryAddDetachedTaskPid(statusFilePath, pid);

  return pid;
}

function tryAddDetachedTaskPid(statusFilePath: string, pid: number): void {
  const status = JSON.parse(readFileSync(statusFilePath, "utf-8")) as {
    status?: string;
    [key: string]: unknown;
  };

  if (status.status !== "running") {
    return;
  }

  writeFileSync(
    statusFilePath,
    JSON.stringify(
      {
        ...status,
        pid,
      },
      null,
      2
    )
  );
}
