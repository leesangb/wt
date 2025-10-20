# wt shell wrapper for fish
# Add this to your ~/.config/fish/config.fish

function wt
    if test "$argv[1]" = "new"; or test "$argv[1]" = "cd"
        set -l output (/path/to/wt $argv)
        set -l exit_code $status
        
        if test $exit_code -eq 0
            set -l cd_cmd (echo "$output" | tail -n 1)
            
            if string match -q "cd *" -- $cd_cmd
                echo "$output" | sed '$d'
                eval $cd_cmd
            else
                echo "$output"
            end
        else
            echo "$output"
            return $exit_code
        end
    else
        /path/to/wt $argv
    end
end
