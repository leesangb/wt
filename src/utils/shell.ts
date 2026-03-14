export type SupportedShell = "bash" | "zsh" | "fish";

interface CommandDefinition {
  name: string;
  description: string;
}

const COMMANDS: CommandDefinition[] = [
  {
    name: "init",
    description: "Initialize wt configuration in current repository",
  },
  { name: "new", description: "Create a new worktree" },
  { name: "list", description: "List all worktrees" },
  { name: "ls", description: "List all worktrees" },
  { name: "remove", description: "Remove a worktree by ID" },
  { name: "rm", description: "Remove a worktree by ID" },
  { name: "cd", description: "Change directory to a worktree" },
  { name: "update", description: "Update wt to the latest release" },
  {
    name: "completion",
    description: "Generate a shell completion script",
  },
  {
    name: "shell-hook",
    description: "Generate a shell integration hook",
  },
];

const SUPPORTED_SHELLS: SupportedShell[] = ["bash", "zsh", "fish"];

function quoteForShell(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

function zshCommandValues(): string {
  return COMMANDS.map(
    command => `        '${command.name}[${command.description}]'`
  ).join(" \\\n");
}

function fishCommandValues(): string {
  return COMMANDS.map(
    command => `${command.name}\\t${command.description}`
  ).join("\n");
}

export function isSupportedShell(value: string): value is SupportedShell {
  return SUPPORTED_SHELLS.includes(value as SupportedShell);
}

export function generateShellHook(
  shell: SupportedShell,
  binaryPath: string = process.execPath
): string {
  const quotedBinaryPath = quoteForShell(binaryPath);

  switch (shell) {
    case "bash":
    case "zsh":
      return `# wt shell hook for ${shell}
__wt_bin=${quotedBinaryPath}

wt() {
  if [ "$1" = "new" ] || [ "$1" = "cd" ]; then
    local output exit_code last_line line_count
    output=$("$__wt_bin" "$@" 2>&1)
    exit_code=$?

    if [ $exit_code -eq 0 ]; then
      last_line=$(printf '%s\\n' "$output" | tail -n 1 | tr -d '\\n')

      if [[ "$last_line" == cd\\ * ]]; then
        line_count=$(printf '%s\\n' "$output" | wc -l | tr -d ' ')
        if [ "$line_count" -gt 1 ]; then
          printf '%s\\n' "$output" | sed '$d'
        fi
        eval "$last_line"
      else
        printf '%s\\n' "$output"
      fi
    else
      printf '%s\\n' "$output"
      return $exit_code
    fi
  else
    "$__wt_bin" "$@"
  fi
}
`;
    case "fish":
      return `# wt shell hook for fish
set -g __wt_bin ${quotedBinaryPath}

function wt --description "Git worktree manager CLI"
    if test (count $argv) -gt 0; and contains -- $argv[1] new cd
        set -l output ($__wt_bin $argv 2>&1)
        set -l exit_code $status

        if test $exit_code -eq 0
            set -l last_line (printf '%s\\n' "$output" | tail -n 1 | tr -d '\\n')

            if string match -q "cd *" -- $last_line
                set -l line_count (printf '%s\\n' "$output" | wc -l | tr -d ' ')
                if test $line_count -gt 1
                    printf '%s\\n' "$output" | sed '$d'
                end
                eval $last_line
            else
                printf '%s\\n' "$output"
            end
        else
            printf '%s\\n' "$output"
            return $exit_code
        end
    else
        $__wt_bin $argv
    end
end
`;
  }
}

export function generateCompletion(
  shell: SupportedShell,
  binaryPath: string = process.execPath
): string {
  const quotedBinaryPath = quoteForShell(binaryPath);

  switch (shell) {
    case "bash":
      return `# wt completion for bash
__wt_completion_bin=${quotedBinaryPath}

_wt_completion() {
  local cur cmd items ids

  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"

  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=($(compgen -W "init new list ls remove rm cd update completion shell-hook" -- "$cur"))
    return
  fi

  case "$cmd" in
    cd|remove|rm)
      if [ "$COMP_CWORD" -eq 2 ]; then
        items=$("$__wt_completion_bin" list --completion bash 2>/dev/null)
        ids=$(printf '%s\\n' "$items" | cut -d: -f1)
        COMPREPLY=($(compgen -W "$ids" -- "$cur"))
      fi
      ;;
    completion|shell-hook)
      if [ "$COMP_CWORD" -eq 2 ]; then
        COMPREPLY=($(compgen -W "bash zsh fish" -- "$cur"))
      fi
      ;;
  esac
}

complete -F _wt_completion wt
`;
    case "zsh":
      return `#compdef wt
# wt completion for zsh
__wt_completion_bin=${quotedBinaryPath}

_wt_completion() {
  local -a suggestions
  local line state

  _arguments -C \\
    '1: :->command' \\
    '*::arg:->args'

  case $state in
    command)
      _values 'command' \\
${zshCommandValues()}
      ;;
    args)
      case $line[1] in
        cd|remove|rm)
          suggestions=("\${(@f)$("$__wt_completion_bin" list --completion zsh 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
        completion|shell-hook)
          _values 'shell' 'bash[Bash]' 'zsh[Zsh]' 'fish[Fish]'
          ;;
      esac
      ;;
  esac
}

compdef _wt_completion wt
`;
    case "fish":
      return `# wt completion for fish
set -g __wt_completion_bin ${quotedBinaryPath}

complete -c wt -f
complete -c wt -n "not __fish_seen_subcommand_from init new list ls remove rm cd update completion shell-hook" -a "${fishCommandValues()}"
complete -c wt -n "__fish_seen_subcommand_from cd remove rm" -a "($__wt_completion_bin list --completion fish 2>/dev/null)" -f
complete -c wt -n "__fish_seen_subcommand_from completion shell-hook" -a "bash\\tBash\nzsh\\tZsh\nfish\\tFish" -f
`;
  }
}
