import { homedir } from "os";
import { join, resolve } from "path";
import { AppError } from "../errors.js";
import { isSupportedShell, type SupportedShell } from "../../domain/shell.js";
import {
  installShellWrapper,
  type InstallShellWrapperResult,
} from "../../infra/shell/installer.js";

export interface InstallShellIntegrationOptions {
  shell: string;
  binaryPath?: string;
  shellDir?: string;
}

export interface InstallShellIntegrationResult
  extends InstallShellWrapperResult {
  binaryPath: string;
  shellDir: string;
}

export function installShellIntegration(
  options: InstallShellIntegrationOptions
): InstallShellIntegrationResult {
  if (!isSupportedShell(options.shell)) {
    throw new AppError(
      `Unsupported shell "${options.shell}". Expected one of: bash, zsh, fish.`
    );
  }

  const binaryPath = resolve(options.binaryPath ?? process.execPath);
  const shellDir = options.shellDir
    ? resolve(options.shellDir)
    : join(homedir(), ".wt", "shell");

  const result = installShellWrapper({
    shell: options.shell as SupportedShell,
    binaryPath,
    shellDir,
  });

  return {
    ...result,
    binaryPath,
    shellDir,
  };
}
