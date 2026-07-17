import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { AppError } from "../../app/errors.js";
import { SUPPORTED_SHELLS, type SupportedShell } from "../../domain/shell.js";

export interface InstallShellWrapperOptions {
  shell: SupportedShell;
  command: string | readonly string[];
  shellDir: string;
  mkdir?: typeof mkdirSync;
  writeFile?: typeof writeFileSync;
}

export interface InstallShellWrapperResult {
  shell: SupportedShell;
  wrapperPath: string;
  sourceLine: string;
}

export interface RefreshShellWrappersResult {
  refreshedShells: SupportedShell[];
  warnings: string[];
}

export interface ShellCommandResult {
  status: number | null;
  signal: NodeJS.Signals | null;
  error?: Error;
  stderr?: string;
  stdout?: string;
}

export type ShellCommandRunner = (
  command: string,
  args: string[],
  options: {
    encoding: "utf-8";
    stdio: "pipe";
  }
) => ShellCommandResult;

export interface RefreshExistingShellWrappersOptions {
  binaryPath: string;
  shellDir?: string;
  runCommand?: ShellCommandRunner;
}

function escapeDoubleQuotedShell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`");
}

function normalizeShellCommand(
  command: string | readonly string[]
): readonly string[] {
  return typeof command === "string" ? [command] : command;
}

function renderShellCommand(command: string | readonly string[]): string {
  return normalizeShellCommand(command)
    .map((part) => `"${escapeDoubleQuotedShell(part)}"`)
    .join(" ");
}

function isPermissionError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;

  return code === "EACCES" || code === "EPERM";
}

function throwShellWriteError(error: unknown, shellDir: string): never {
  if (isPermissionError(error)) {
    throw new AppError(
      `Could not write wt shell integration in ${shellDir}. This usually means the directory is owned by another user. Run: sudo chown -R "$(id -u):$(id -g)" ~/.wt`
    );
  }

  throw error;
}

function renderPosixReloadAfterUpdate(wrapperPath?: string): string {
  if (!wrapperPath) {
    return "";
  }

  return `
  local __wt_wrapper_path="${escapeDoubleQuotedShell(wrapperPath)}"
  if [ "\${1:-}" = "update" ] && [ $exit_code -eq 0 ] && [ -r "$__wt_wrapper_path" ]; then
    source "$__wt_wrapper_path"
  fi
`;
}

function renderFishReloadAfterUpdate(wrapperPath?: string): string {
  if (!wrapperPath) {
    return "";
  }

  return `
    set -l __wt_wrapper_path "${escapeDoubleQuotedShell(wrapperPath)}"
    if test (count $argv) -gt 0; and test "$argv[1]" = update; and test $exit_code -eq 0; and test -r "$__wt_wrapper_path"
        source "$__wt_wrapper_path"
    end
`;
}

export function getShellWrapperFileName(shell: SupportedShell): string {
  return `wt.${shell}`;
}

export function getShellWrapperPath(
  shell: SupportedShell,
  shellDir: string
): string {
  return join(shellDir, getShellWrapperFileName(shell));
}

export function getShellSourceLine(
  shell: SupportedShell,
  shellDir: string
): string {
  const wrapperPath = getShellWrapperPath(shell, shellDir);
  return `source "${escapeDoubleQuotedShell(wrapperPath)}"`;
}

function renderBashWrapper(
  command: string | readonly string[],
  wrapperPath?: string
): string {
  const renderedCommand = renderShellCommand(command);
  const reloadAfterUpdate = renderPosixReloadAfterUpdate(wrapperPath);

  return `# wt shell wrapper for bash
# Add this to your ~/.bashrc

wt() {
  local cd_file target_dir cd_status
  cd_file=$(mktemp)
  WT_SHELL_CD_FILE="$cd_file" ${renderedCommand} "$@"
  local exit_code=$?

  if [ -s "$cd_file" ]; then
    target_dir=$(tail -n 1 "$cd_file")
    builtin cd -- "$target_dir"
    cd_status=$?
    if [ $cd_status -ne 0 ] && [ $exit_code -eq 0 ]; then
      exit_code=$cd_status
    fi
  fi

  rm -f "$cd_file"
${reloadAfterUpdate}
  return $exit_code
}

_wt_completion() {
  case "\${COMP_WORDS[1]}" in
    cd)
      if [ $COMP_CWORD -eq 2 ]; then
        local items=$(${renderedCommand} list --completion bash 2>/dev/null)
        local ids=$(echo "$items" | cut -d: -f1)
        COMPREPLY=($(compgen -W "$ids" -- "\${COMP_WORDS[2]}"))
      fi
      ;;
    rm|remove)
      if [ $COMP_CWORD -ge 2 ]; then
        local items=$(${renderedCommand} list --completion bash --exclude-main-worktree 2>/dev/null)
        local ids=$(echo "$items" | cut -d: -f1)
        COMPREPLY=($(compgen -W "$ids" -- "\${COMP_WORDS[$COMP_CWORD]}"))
      fi
      ;;
    pr)
      if [ $COMP_CWORD -eq 2 ]; then
        local items=$(${renderedCommand} _complete-pr bash 2>/dev/null)
        local numbers=$(echo "$items" | cut -d: -f1)
        COMPREPLY=($(compgen -W "$numbers" -- "\${COMP_WORDS[2]}"))
      fi
      ;;
  esac
}

complete -F _wt_completion wt
`;
}

function renderZshWrapper(
  command: string | readonly string[],
  wrapperPath?: string
): string {
  const renderedCommand = renderShellCommand(command);
  const reloadAfterUpdate = renderPosixReloadAfterUpdate(wrapperPath);

  return `# wt shell wrapper for zsh
# Add this to your ~/.zshrc

wt() {
  local cd_file target_dir cd_status
  cd_file=$(mktemp)
  WT_SHELL_CD_FILE="$cd_file" ${renderedCommand} "$@"
  local exit_code=$?

  if [ -s "$cd_file" ]; then
    target_dir=$(tail -n 1 "$cd_file")
    builtin cd -- "$target_dir"
    cd_status=$?
    if [ $cd_status -ne 0 ] && [ $exit_code -eq 0 ]; then
      exit_code=$cd_status
    fi
  fi

  rm -f "$cd_file"
${reloadAfterUpdate}
  return $exit_code
}

_wt_completion() {
  local -a suggestions
  local line state

  _arguments -C \\
    '1: :->command' \\
    '*::arg:->args'

  case $state in
    command)
      _values 'command' \\
        'new[Create a new worktree]' \\
        'checkout[Create or navigate to a local branch worktree]' \\
        'switch[Alias for checkout]' \\
        'list[List all worktrees]' \\
        'ls[List all worktrees]' \\
        'remove[Remove a worktree]' \\
        'rm[Remove a worktree]' \\
        'rename[Rename the current worktree ID]' \\
        'clean[Bulk-remove worktrees interactively]' \\
        'cd[Change directory to a worktree]' \\
        'pr[Create or navigate to a pull request worktree]' \\
        'update[Update wt to latest version]' \\
        'init[Initialize wt configuration]' \\
        'shell[Manage shell integration]'
      ;;
    args)
      case $line[1] in
        cd)
          suggestions=("\${(@f)$(${renderedCommand} list --completion zsh 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
        rm|remove)
          suggestions=("\${(@f)$(${renderedCommand} list --completion zsh --exclude-main-worktree 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
        pr)
          suggestions=("\${(@f)$(${renderedCommand} _complete-pr zsh 2>/dev/null)}")
          _describe 'pull request' suggestions
          ;;
      esac
      ;;
  esac
}

compdef _wt_completion wt
`;
}

function renderFishWrapper(
  command: string | readonly string[],
  wrapperPath?: string
): string {
  const renderedCommand = renderShellCommand(command);
  const reloadAfterUpdate = renderFishReloadAfterUpdate(wrapperPath);

  return `# wt shell wrapper for fish
# Add this to your ~/.config/fish/config.fish

function wt
    set -l cd_file (mktemp)
    env WT_SHELL_CD_FILE="$cd_file" ${renderedCommand} $argv
    set -l exit_code $status

    if test -s "$cd_file"
        set -l target_dir (string trim (cat "$cd_file"))
        builtin cd -- $target_dir
        set -l cd_status $status
        if test $cd_status -ne 0; and test $exit_code -eq 0
            set exit_code $cd_status
        end
    end

    rm -f "$cd_file"
${reloadAfterUpdate}
    return $exit_code
end

function __wt_complete_cd
    ${renderedCommand} list --completion fish 2>/dev/null
end

function __wt_complete_remove
    ${renderedCommand} list --completion fish --exclude-main-worktree 2>/dev/null
end

function __wt_complete_pr
    ${renderedCommand} _complete-pr fish 2>/dev/null
end

complete -c wt -n "__fish_seen_subcommand_from cd" -a "(__wt_complete_cd)" -f
complete -c wt -n "__fish_seen_subcommand_from rm remove" -a "(__wt_complete_remove)" -f
complete -c wt -n "__fish_seen_subcommand_from pr" -a "(__wt_complete_pr)" -f
`;
}

export function renderShellWrapper(
  shell: SupportedShell,
  command: string | readonly string[],
  options: { wrapperPath?: string } = {}
): string {
  switch (shell) {
    case "bash":
      return renderBashWrapper(command, options.wrapperPath);
    case "zsh":
      return renderZshWrapper(command, options.wrapperPath);
    case "fish":
      return renderFishWrapper(command, options.wrapperPath);
  }
}

export function installShellWrapper(
  options: InstallShellWrapperOptions
): InstallShellWrapperResult {
  try {
    (options.mkdir ?? mkdirSync)(options.shellDir, { recursive: true });
  } catch (error) {
    throwShellWriteError(error, options.shellDir);
  }

  const wrapperPath = getShellWrapperPath(options.shell, options.shellDir);

  try {
    (options.writeFile ?? writeFileSync)(
      wrapperPath,
      renderShellWrapper(options.shell, options.command, { wrapperPath }),
      "utf-8"
    );
  } catch (error) {
    throwShellWriteError(error, options.shellDir);
  }

  return {
    shell: options.shell,
    wrapperPath,
    sourceLine: getShellSourceLine(options.shell, options.shellDir),
  };
}

export function refreshExistingShellWrappers(
  options: RefreshExistingShellWrappersOptions
): RefreshShellWrappersResult {
  const shellDir = options.shellDir ?? join(homedir(), ".wt", "shell");
  const runCommand =
    options.runCommand ??
    ((command, args, commandOptions) =>
      spawnSync(command, args, commandOptions));
  const refreshedShells: SupportedShell[] = [];
  const warnings: string[] = [];

  for (const shell of SUPPORTED_SHELLS) {
    const wrapperPath = getShellWrapperPath(shell, shellDir);

    if (!existsSync(wrapperPath)) {
      continue;
    }

    const result = runCommand(
      options.binaryPath,
      ["shell", "install", shell, "--binary-path", options.binaryPath],
      {
        encoding: "utf-8",
        stdio: "pipe",
      }
    );

    if (result.error) {
      warnings.push(
        `Could not refresh ${shell} shell wrapper at ${wrapperPath}: ${result.error.message}`
      );
      continue;
    }

    if (result.status !== 0) {
      const stderr = result.stderr?.trim();
      warnings.push(
        `Could not refresh ${shell} shell wrapper at ${wrapperPath}: ${
          stderr || `shell install exited with status ${result.status}`
        }`
      );
      continue;
    }

    refreshedShells.push(shell);
  }

  return {
    refreshedShells,
    warnings,
  };
}
