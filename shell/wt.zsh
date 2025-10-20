# wt shell wrapper for zsh
# Add this to your ~/.zshrc

wt() {
  if [ "$1" = "new" ] || [ "$1" = "cd" ]; then
    local output
    output=$(/path/to/wt "$@")
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
      local cd_cmd=$(echo "$output" | tail -n 1)
      
      if [[ "$cd_cmd" == cd\ * ]]; then
        echo "$output" | sed '$d'
        eval "$cd_cmd"
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
