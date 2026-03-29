# wt shell wrapper for zsh
# Add this to your ~/.zshrc

wt() {
  local cd_file target_dir cd_status
  cd_file=$(mktemp)
  WT_SHELL_CD_FILE="$cd_file" command wt "$@"
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

  _arguments -C \
    '1: :->command' \
    '*::arg:->args'

  case $state in
    command)
      _values 'command' \
        'new[Create a new worktree]' \
        'checkout[Create or navigate to a local branch worktree]' \
        'switch[Alias for checkout]' \
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
          suggestions=("${(@f)$(command wt list --completion zsh 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
        rm|remove)
          suggestions=("${(@f)$(command wt list --completion zsh --exclude-main-worktree 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
      esac
      ;;
  esac
}

compdef _wt_completion wt
