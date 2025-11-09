# wt shell wrapper for fish
# Add this to your ~/.config/fish/config.fish

function wt
    if test "$argv[1]" = "new"; or test "$argv[1]" = "cd"
        set -l output (/path/to/wt $argv 2>&1)
        set -l exit_code $status
        
        if test $exit_code -eq 0
            set -l last_line (echo "$output" | tail -n 1 | tr -d '\n')
            
            if string match -q "cd *" -- $last_line
                set -l lines (echo "$output" | wc -l | tr -d ' ')
                if test $lines -gt 1
                    echo "$output" | sed '$d'
                end
                eval $last_line
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

complete -c wt -n "__fish_seen_subcommand_from cd" -a "(/path/to/wt list --completion fish 2>/dev/null)" -f
