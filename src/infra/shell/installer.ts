import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import type { SupportedShell } from "../../domain/shell.js";

export interface InstallShellWrapperOptions {
  shell: SupportedShell;
  binaryPath: string;
  shellDir: string;
}

export interface InstallShellWrapperResult {
  shell: SupportedShell;
  wrapperPath: string;
  sourceLine: string;
}

function escapeDoubleQuotedShell(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("$", "\\$")
    .replaceAll("`", "\\`");
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

function renderBashWrapper(binaryPath: string): string {
  const escapedBinaryPath = escapeDoubleQuotedShell(binaryPath);

  return `# wt shell wrapper for bash
# Add this to your ~/.bashrc

wt() {
  local cd_file target_dir cd_status
  cd_file=$(mktemp)
  WT_SHELL_CD_FILE="$cd_file" "${escapedBinaryPath}" "$@"
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
  return $exit_code
}

_wt_completion() {
  case "\${COMP_WORDS[1]}" in
    cd)
      if [ $COMP_CWORD -eq 2 ]; then
        local items=$("${escapedBinaryPath}" list --completion bash 2>/dev/null)
        local ids=$(echo "$items" | cut -d: -f1)
        COMPREPLY=($(compgen -W "$ids" -- "\${COMP_WORDS[2]}"))
      fi
      ;;
    rm|remove)
      if [ $COMP_CWORD -ge 2 ]; then
        local items=$("${escapedBinaryPath}" list --completion bash --exclude-main-worktree 2>/dev/null)
        local ids=$(echo "$items" | cut -d: -f1)
        COMPREPLY=($(compgen -W "$ids" -- "\${COMP_WORDS[$COMP_CWORD]}"))
      fi
      ;;
  esac
}

complete -F _wt_completion wt
`;
}

function renderZshWrapper(binaryPath: string): string {
  const escapedBinaryPath = escapeDoubleQuotedShell(binaryPath);

  return `# wt shell wrapper for zsh
# Add this to your ~/.zshrc

wt() {
  local cd_file target_dir cd_status
  cd_file=$(mktemp)
  WT_SHELL_CD_FILE="$cd_file" "${escapedBinaryPath}" "$@"
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
        'cd[Change directory to a worktree]' \\
        'pr[Create or navigate to a pull request worktree]' \\
        'update[Update wt to latest version]' \\
        'init[Initialize wt configuration]' \\
        'shell[Manage shell integration]'
      ;;
    args)
      case $line[1] in
        cd)
          suggestions=("\${(@f)$("${escapedBinaryPath}" list --completion zsh 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
        rm|remove)
          suggestions=("\${(@f)$("${escapedBinaryPath}" list --completion zsh --exclude-main-worktree 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
      esac
      ;;
  esac
}

compdef _wt_completion wt
`;
}

function renderFishWrapper(binaryPath: string): string {
  const escapedBinaryPath = escapeDoubleQuotedShell(binaryPath);

  return `# wt shell wrapper for fish
# Add this to your ~/.config/fish/config.fish

function wt
    set -l cd_file (mktemp)
    env WT_SHELL_CD_FILE="$cd_file" "${escapedBinaryPath}" $argv
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
    return $exit_code
end

complete -c wt -n "__fish_seen_subcommand_from cd" -a "("${escapedBinaryPath}" list --completion fish 2>/dev/null)" -f
complete -c wt -n "__fish_seen_subcommand_from rm remove" -a "("${escapedBinaryPath}" list --completion fish --exclude-main-worktree 2>/dev/null)" -f
`;
}

export function renderShellWrapper(
  shell: SupportedShell,
  binaryPath: string
): string {
  switch (shell) {
    case "bash":
      return renderBashWrapper(binaryPath);
    case "zsh":
      return renderZshWrapper(binaryPath);
    case "fish":
      return renderFishWrapper(binaryPath);
  }
}

export function installShellWrapper(
  options: InstallShellWrapperOptions
): InstallShellWrapperResult {
  mkdirSync(options.shellDir, { recursive: true });

  const wrapperPath = getShellWrapperPath(options.shell, options.shellDir);
  writeFileSync(
    wrapperPath,
    renderShellWrapper(options.shell, options.binaryPath),
    "utf-8"
  );

  return {
    shell: options.shell,
    wrapperPath,
    sourceLine: getShellSourceLine(options.shell, options.shellDir),
  };
}
