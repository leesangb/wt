# wt shell wrapper for fish
# Add this to your ~/.config/fish/config.fish

function wt
    set -l cd_file (mktemp)
    env WT_SHELL_CD_FILE="$cd_file" command wt $argv
    set -l exit_code $status

    if test -s "$cd_file"
        set -l target_dir (string trim (cat "$cd_file"))
        builtin cd -- $target_dir
        set -l cd_status $status
        if test $cd_status -ne 0; and test $exit_code -eq 0
            set exit_code $cd_status
        end
    end

    rm -f "$cd_file"
    return $exit_code
end

complete -c wt -n "__fish_seen_subcommand_from cd" -a "(command wt list --completion fish 2>/dev/null)" -f
complete -c wt -n "__fish_seen_subcommand_from rm remove" -a "(command wt list --completion fish --exclude-main-worktree 2>/dev/null)" -f
