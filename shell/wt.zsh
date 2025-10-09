# wt shell wrapper for zsh
# Add this to your ~/.zshrc

wt() {
  if [ "$1" = "new" ]; then
    local output
    output=$(/path/to/wt "$@")
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
      # Extract the cd command from the last line
      local cd_cmd=$(echo "$output" | tail -n 1)
      
      # Print all output except the cd command
      echo "$output" | head -n -1
      
      # Execute the cd command if it starts with "cd "
      if [[ "$cd_cmd" == cd\ * ]]; then
        eval "$cd_cmd"
      else
        echo "$cd_cmd"
      fi
    else
      echo "$output"
      return $exit_code
    fi
  else
    /path/to/wt "$@"
  fi
}
