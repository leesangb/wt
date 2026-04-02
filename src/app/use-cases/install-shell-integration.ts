import { homedir } from "os";
import { basename, join, resolve } from "path";
import { AppError } from "../errors.js";
import { isSupportedShell, type SupportedShell } from "../../domain/shell.js";
import {
  installShellWrapper,
  type InstallShellWrapperResult,
} from "../../infra/shell/installer.js";

const RUNTIME_LAUNCHERS = new Set(["bun", "node"]);

export interface ShellCommandContext {
  argv0: string;
  argv: string[];
  execPath: string;
}

export interface InstallShellIntegrationOptions {
  shell: string;
  binaryPath?: string;
}

export interface InstallShellIntegrationResult
  extends InstallShellWrapperResult {
  command: string[];
}

export function resolveDefaultShellCommand(
  context: ShellCommandContext = {
    argv0: process.argv0,
    argv: process.argv,
    execPath: process.execPath,
  }
): string[] {
  const launcherName = basename(context.argv0 || "").toLowerCase();
  const hasExplicitPath =
    context.argv0.includes("/") || context.argv0.includes("\\");

  if (
    context.argv0 &&
    hasExplicitPath &&
    !RUNTIME_LAUNCHERS.has(launcherName)
  ) {
    return [resolve(context.argv0)];
  }

  if (context.argv[1]) {
    if (context.argv[1].startsWith("/$bunfs/")) {
      return [resolve(context.execPath)];
    }

    return [resolve(context.execPath), resolve(context.argv[1])];
  }

  return [resolve(context.execPath)];
}

export function installShellIntegration(
  options: InstallShellIntegrationOptions
): InstallShellIntegrationResult {
  if (!isSupportedShell(options.shell)) {
    throw new AppError(
      `Unsupported shell "${options.shell}". Expected one of: bash, zsh, fish.`
    );
  }

  const command = options.binaryPath
    ? [resolve(options.binaryPath)]
    : resolveDefaultShellCommand();
  const shellDir = join(homedir(), ".wt", "shell");

  const result = installShellWrapper({
    shell: options.shell as SupportedShell,
    command,
    shellDir,
  });

  return {
    ...result,
    command: [...command],
  };
}
