# wt - Git Worktree Manager

A CLI tool to manage git worktrees with pre/post script support.

## Features

- 🚀 Create worktrees with short IDs and repo-based naming
- 🎯 Auto-cd to new worktree (with shell wrapper integration)
- ⚙️ Configure worktree base directory, base branch, and remote push behavior per repository
- 🔄 Auto-fetch latest changes before creating worktree
- 📤 Auto-push new branch to remote (configurable)
- 🎯 Pre/post script execution for automation with environment variables
- 📦 Fast and lightweight Bun-based binary
- 🎨 Colored CLI output for better UX

## Installation

### Build from Source

```bash
# Clone the repository
git clone https://github.com/leesangb/wt.git
cd wt

# Run the installation script (handles build automatically)
./install.sh

# To update to a newer version, use --force
./install.sh --force
```

The installation script will:
- Check if Bun is installed
- Run `bun install` and `bun run build` automatically
- Install the `wt` binary to `~/.local/bin/wt`
- Automatically add shell wrapper functions to your shell config files (`.zshrc`, `.bashrc`, or `config.fish`)
- Set up auto-cd functionality

After installation, restart your shell or run:
```bash
source ~/.zshrc  # or ~/.bashrc or ~/.config/fish/config.fish
```

### Manual Shell Integration (Optional)

If you prefer manual setup, add a shell wrapper function for auto-cd functionality:

#### Zsh (~/.zshrc)

```bash
# Source the wt wrapper
source /path/to/wt/shell/wt.zsh

# Or copy this function:
wt() {
  if [ "$1" = "new" ]; then
    local output
    output=$(/path/to/wt "$@")
    local exit_code=$?
    
    if [ $exit_code -eq 0 ]; then
      local cd_cmd=$(echo "$output" | tail -n 1)
      echo "$output" | head -n -1
      
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
```

#### Bash (~/.bashrc)

```bash
# Source the wt wrapper
source /path/to/wt/shell/wt.bash

# Or use the same function as zsh
```

#### Fish (~/.config/fish/config.fish)

```fish
# Source the wt wrapper
source /path/to/wt/shell/wt.fish

# Or copy this function:
function wt
    if test "$argv[1]" = "new"
        set -l output (/path/to/wt $argv)
        set -l exit_code $status
        
        if test $exit_code -eq 0
            set -l cd_cmd (echo "$output" | tail -n 1)
            echo "$output" | head -n -1
            
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
```

**Note:** Replace `/path/to/wt` with the actual path to the binary.

### Uninstallation

```bash
# Run the uninstallation script
./uninstall.sh

# Or manually remove:
rm ~/.local/bin/wt
# Then remove the wrapper function from your shell config files
```

### Without Shell Integration

If you don't set up the shell wrapper, you can use `--no-cd` flag:

```bash
wt new feature-branch --no-cd
# Then manually: cd /path/shown/in/output
```

## Usage

### Initialize configuration

```bash
wt init
```

This creates `.wt/settings.json` in your repository:

```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "main",
  "pushRemote": true,
  "scripts": {
    "pre": [],
    "post": []
  }
}
```

### Create a new worktree

```bash
# Create and auto-cd (requires shell wrapper)
wt new feature-branch

# Specify base branch
wt new feature-branch --base develop

# Skip pushing to remote
wt new feature-branch --no-push-remote

# Direct binary usage without auto-cd
wt new feature-branch --no-cd
```

This will:
1. Fetch the latest changes from remote (`git fetch`)
2. Run the pre scripts (if configured)
3. Create a worktree at `~/.wt/<reponame-shortid>` with branch `feature-branch`
4. Push the new branch to remote (if enabled)
5. Run the post scripts in the new worktree (if configured)
6. Automatically change to the new worktree directory (with shell wrapper)

**Options:**
- `--base <branch>` - Base branch to create from (default: from settings or `main`)
- `--no-push-remote` - Skip pushing the new branch to remote
- `--no-cd` - Don't output cd command (for direct binary usage without shell wrapper)

### List all worktrees

```bash
wt list
# or
wt ls
```

### Remove a worktree

```bash
wt remove <id>
# or
wt rm <id>
```

The ID is the short ID shown when creating the worktree (e.g., `x7k2m9n4`).

## Configuration

Edit `.wt/settings.json` in your repository:

- **worktreeDir**: Base directory for worktrees (default: `~/.wt`)
- **baseBranch**: Default base branch for new worktrees (default: `main`)
- **pushRemote**: Auto-push new branch to remote (default: `true`)
- **scripts.pre**: Array of commands to run before creating worktree (runs in repo root)
- **scripts.post**: Array of commands to run after creating worktree (runs in new worktree directory)

### Environment Variables

Scripts have access to these environment variables:

- `$WT_PATH` - Full path to the worktree directory
- `$WT_ID` - Short ID of the worktree (e.g., `x7k2m9n4`)
- `$WT_BRANCH` - Branch name

### Example configurations

**Basic setup with develop as base:**
```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "develop",
  "pushRemote": true,
  "scripts": {
    "pre": [],
    "post": []
  }
}
```

**Install dependencies after creating worktree:**
```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "main",
  "pushRemote": true,
  "scripts": {
    "pre": [],
    "post": ["npm install"]
  }
}
```

**Skip auto-push, install dependencies, and open in VS Code:**
```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "main",
  "pushRemote": false,
  "scripts": {
    "pre": [],
    "post": ["npm install", "code $WT_PATH"]
  }
}
```

**Multiple sequential commands:**
```json
{
  "worktreeDir": "~/projects/worktrees",
  "baseBranch": "develop",
  "pushRemote": true,
  "scripts": {
    "pre": [
      "echo Creating worktree for branch: $WT_BRANCH"
    ],
    "post": [
      "npm install",
      "npm run build",
      "echo Worktree ready at $WT_PATH"
    ]
  }
}
```

## Project Structure

```
wt/
├── src/
│   ├── index.ts              # CLI entry point
│   ├── commands/
│   │   ├── init.ts           # wt init
│   │   ├── new.ts            # wt new
│   │   ├── list.ts           # wt list
│   │   └── remove.ts         # wt remove
│   ├── config/
│   │   └── settings.ts       # Settings management
│   ├── utils/
│   │   ├── git.ts            # Git worktree utilities
│   │   ├── script.ts         # Script execution
│   │   └── id.ts             # Short ID generation
│   └── types/
│       └── index.ts          # TypeScript types
├── shell/
│   ├── wt.zsh                # Zsh wrapper function
│   ├── wt.bash               # Bash wrapper function
│   └── wt.fish               # Fish wrapper function
├── package.json
└── tsconfig.json
```

## Development

```bash
# Install dependencies
bun install

# Build standalone binary
bun run build

# The binary will be created at ./wt
# Test it with: ./wt --help
```

## License

MIT
