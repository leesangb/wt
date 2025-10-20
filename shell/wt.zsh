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
