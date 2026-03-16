# wt shell wrapper for fish
# Add this to your ~/.config/fish/config.fish

function wt
    if test "$argv[1]" = "new"; or test "$argv[1]" = "cd"; or test "$argv[1]" = "pr"
        set -l cd_file (mktemp)
        env WT_SHELL_CD_FILE="$cd_file" /path/to/wt $argv
        set -l exit_code $status
        
        if test $exit_code -eq 0; and test -s "$cd_file"
            set -l target_dir (string trim (cat "$cd_file"))
            builtin cd -- $target_dir
            set -l cd_status $status
            if test $cd_status -ne 0
                set exit_code $cd_status
            end
        end

        rm -f "$cd_file"
        return $exit_code
    else
        /path/to/wt $argv
    end
end

complete -c wt -n "__fish_seen_subcommand_from cd" -a "(/path/to/wt list --completion fish 2>/dev/null)" -f
complete -c wt -n "__fish_seen_subcommand_from rm remove" -a "(/path/to/wt list --completion fish --exclude-main-worktree 2>/dev/null)" -f
