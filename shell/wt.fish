# wt shell wrapper for fish
# Add this to your ~/.config/fish/config.fish

function wt
    if test "$argv[1]" = "new"
        set -l output (/path/to/wt $argv)
        set -l exit_code $status
        
        if test $exit_code -eq 0
            # Extract the cd command from the last line
            set -l cd_cmd (echo "$output" | tail -n 1)
            
            # Print all output except the cd command
            echo "$output" | head -n -1
            
            # Execute the cd command if it starts with "cd "
            if string match -q "cd *" -- $cd_cmd
                eval $cd_cmd
            else
                echo $cd_cmd
            end
        else
            echo "$output"
            return $exit_code
        end
    else
        /path/to/wt $argv
    end
end
