# wt shell wrapper for bash
# Add this to your ~/.bashrc

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
          echo "$output" | sed '$d'
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
  if [ "${COMP_WORDS[1]}" = "cd" ] && [ $COMP_CWORD -eq 2 ]; then
    local items=$(/path/to/wt list --completion bash 2>/dev/null)
    local ids=$(echo "$items" | cut -d: -f1)
    COMPREPLY=($(compgen -W "$ids" -- "${COMP_WORDS[2]}"))
  fi
}

complete -F _wt_completion wt
