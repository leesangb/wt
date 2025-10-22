# wt shell wrapper for zsh
# Add this to your ~/.zshrc

wt() {
  if [ "$1" = "new" ] || [ "$1" = "cd" ]; then
    local output
    output=$(/path/to/wt "$@" 2>&1)
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
      local last_line=$(echo "$output" | tail -n 1 | tr -d '\n')
      
      if [[ "$last_line" == cd\ * ]]; then
        local lines=$(echo "$output" | wc -l | tr -d ' ')
        if [ "$lines" -gt 1 ]; then
          echo "$output" | head -n -1
        fi
        eval "$last_line"
      else
        echo "$output"
      fi
    else
      echo "$output"
      return $exit_code
    fi
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
        'update[Update wt to latest version]' \
        'init[Initialize wt configuration]'
      ;;
    args)
      case $line[1] in
        cd)
          suggestions=("${(@f)$(/path/to/wt list --completion zsh 2>/dev/null)}")
          _describe 'worktree' suggestions
          ;;
      esac
      ;;
  esac
}

compdef _wt_completion wt
