# wt shell wrapper for bash
# Add this to your ~/.bashrc

wt() {
  if [ "$1" = "new" ] || [ "$1" = "cd" ] || [ "$1" = "pr" ] || [ "$1" = "rm" ] || [ "$1" = "remove" ]; then
    local cd_file target_dir cd_status
    cd_file=$(mktemp)
    WT_SHELL_CD_FILE="$cd_file" /path/to/wt "$@"
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
  else
    /path/to/wt "$@"
  fi
}

_wt_completion() {
  case "${COMP_WORDS[1]}" in
    cd)
      if [ $COMP_CWORD -eq 2 ]; then
        local items=$(/path/to/wt list --completion bash 2>/dev/null)
        local ids=$(echo "$items" | cut -d: -f1)
        COMPREPLY=($(compgen -W "$ids" -- "${COMP_WORDS[2]}"))
      fi
      ;;
    rm|remove)
      if [ $COMP_CWORD -ge 2 ]; then
        local items=$(/path/to/wt list --completion bash --exclude-main-worktree 2>/dev/null)
        local ids=$(echo "$items" | cut -d: -f1)
        COMPREPLY=($(compgen -W "$ids" -- "${COMP_WORDS[$COMP_CWORD]}"))
      fi
      ;;
  esac
}

complete -F _wt_completion wt
