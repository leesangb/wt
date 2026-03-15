# wt shell wrapper for bash
# Add this to your ~/.bashrc

wt() {
  if [ "$1" = "new" ] || [ "$1" = "cd" ]; then
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
  if [ "${COMP_WORDS[1]}" = "cd" ] && [ $COMP_CWORD -eq 2 ]; then
    local items=$(/path/to/wt list --completion bash 2>/dev/null)
    local ids=$(echo "$items" | cut -d: -f1)
    COMPREPLY=($(compgen -W "$ids" -- "${COMP_WORDS[2]}"))
  fi
}

complete -F _wt_completion wt
