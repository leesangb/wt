# wt shell wrapper for zsh
# Add this to your ~/.zshrc

wt() {
  if [ "$1" = "new" ] || [ "$1" = "cd" ] || [ "$1" = "pr" ]; then
    local cd_file target_dir
    cd_file=$(mktemp)
    WT_SHELL_CD_FILE="$cd_file" /path/to/wt "$@"
    local exit_code=$?
    
    if [ $exit_code -eq 0 ] && [ -s "$cd_file" ]; then
      target_dir=$(tail -n 1 "$cd_file")
      builtin cd -- "$target_dir" || exit_code=$?
    fi

    rm -f "$cd_file"
    return $exit_code
  else
    /path/to/wt "$@"
  fi
}

_wt_completion() {
  local -a suggestions
  local line state

  _arguments -C \
    '1: :->command' \
    '*::arg:->args'

  case $state in
    command)
      _values 'command' \
        'new[Create a new worktree]' \
        'list[List all worktrees]' \
        'ls[List all worktrees]' \
        'remove[Remove a worktree]' \
        'rm[Remove a worktree]' \
        'cd[Change directory to a worktree]' \
        'pr[Create or navigate to a pull request worktree]' \
        'update[Update wt to latest version]' \
        'init[Initialize wt configuration]'
      ;;
    args)
      case $line[1] in
        cd)
          suggestions=("${(@f)$(/path/to/wt list --completion zsh 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
        rm|remove)
          suggestions=("${(@f)$(/path/to/wt list --completion zsh --exclude-main-worktree 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
      esac
      ;;
  esac
}

compdef _wt_completion wt
