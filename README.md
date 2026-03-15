# wt - Git Worktree Manager

English | [한국어](./README.ko.md)

A CLI tool to manage git worktrees with pre/post script support.

## Features

- 🚀 Create worktrees with branch-based IDs and repo-based naming
- 🎯 Auto-cd to new worktree (with shell wrapper integration)
- ⚙️ Configure worktree base directory, base branch, and remote push behavior per repository
- 🔄 Auto-fetch latest changes before creating worktree
- 📤 Auto-push to remote by default (disable with `--no-push` flag)
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
- Copy shell wrapper scripts to `~/.wt/shell/`
- Automatically add shell wrapper source lines to your shell config files (`.zshrc`, `.bashrc`, or `config.fish`)
- Set up auto-cd functionality

After installation, restart your shell or run:
```bash
source ~/.zshrc  # or ~/.bashrc or ~/.config/fish/config.fish
```

### Manual Shell Integration (Optional)

If you prefer manual setup or if the installation script didn't automatically configure your shell, you can manually source the wrapper scripts that are installed at `~/.wt/shell/`:

#### Zsh (~/.zshrc)

```bash
source ~/.wt/shell/wt.zsh
```

#### Bash (~/.bashrc)

```bash
source ~/.wt/shell/wt.bash
```

#### Fish (~/.config/fish/config.fish)

```fish
source ~/.wt/shell/wt.fish
```

**Note:** The shell wrapper scripts are automatically installed to `~/.wt/shell/` during installation.

### Uninstallation

```bash
# Run the uninstallation script
./uninstall.sh

# This will:
# - Remove the wt binary from ~/.local/bin/
# - Remove shell wrapper scripts from ~/.wt/shell/
# - Remove source lines from shell config files
```

**Note:** The uninstallation script does not remove worktrees or repository-specific `.wt/settings.json` files. To fully clean up, manually run:
```bash
rm -rf ~/.wt/  # Remove all worktrees and shell scripts
```

### Without Shell Integration

If you don't set up the shell wrapper, you can use `--no-cd` flag:

```bash
wt new feature-branch --no-cd
# Then manually: cd /path/shown/in/output
```

## Usage

**Note:** You can run `wt` from any directory inside a git repository. Commands resolve the repository root internally, while relative `worktreeDir` values in `.wt/settings.json` are interpreted relative to the repository root.

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
    "post": [],
    "postMode": "async"
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
wt new feature-branch --no-push

# Direct binary usage without auto-cd
wt new feature-branch --no-cd
```

This will:
1. Fetch the latest changes from remote (`git fetch`)
2. Run the pre scripts (if configured)
3. Create a worktree at `~/.wt/<reponame-feature-branch>` with branch `feature-branch`
4. Push the new branch to remote with upstream tracking (unless `--no-push` is used)
5. Run the post scripts in the new worktree (if configured)
6. Automatically change to the new worktree directory (with shell wrapper)

When post scripts run in async mode, `wt` returns immediately and writes status/log files under `<worktree>/.wt/` (`post-task.json`, `post-task.log`).

By default, `WT_ID` uses the branch name. When the branch contains `/`, the worktree directory name replaces it with `-`, while the stored ID remains unchanged. For example, `feature/issue-12` becomes `~/.wt/<reponame-feature-issue-12>`. If that sanitized path is already taken by another worktree ID, `wt` appends a short suffix to keep the directory unique.

**Options:**
- `--base <branch>` - Base branch to create from (default: from settings or `main`)
- `--id <id>` - Override the default worktree ID (defaults to the branch name)
- `--no-push` - Skip pushing the new branch to remote
- `--no-cd` - Don't output cd command (for direct binary usage without shell wrapper)

### Update wt

Update to the latest release (macOS only for now):
```bash
wt update
```

Force re-download current version:
```bash
wt update --force
```

Install a specific version:
```bash
wt update --version 0.1.2
```

Skip removing quarantine attribute:
```bash
wt update --no-remove-quarantine
```

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

If the worktree has modified files or unpushed commits, `wt rm` asks for confirmation before deleting it. Use `wt rm <id> --force` to skip the prompt.

You can remove a worktree using:
- ID (defaults to the branch name, e.g., `feature/issue-12`)
- Full ID with repo prefix (e.g., `myrepo-feature/issue-12`)
- Any part of the path that uniquely identifies the worktree

## Configuration

Edit `.wt/settings.json` in your repository:

- **worktreeDir**: Base directory for worktrees (default: `~/.wt`)
- **baseBranch**: Default base branch for new worktrees (default: `main`)
- **pushRemote**: Auto-push new branch to remote (default: `true`)
- **scripts.pre**: Array of commands to run before creating worktree (runs in repo root)
- **scripts.post**: Array of commands to run after creating worktree (runs in new worktree directory)
- **scripts.postMode**: `async` (default) or `sync` for foreground execution

### Environment Variables

Scripts have access to these environment variables:

- `$WT_PATH` - Full path to the worktree directory
- `$WT_ID` - Worktree ID (defaults to the branch name, e.g., `feature/issue-12`)
- `$WT_FULL_ID` - Full ID with repo prefix (e.g., `myrepo-feature/issue-12`)
- `$WT_BRANCH` - Branch name
- `$WT_REPO_ROOT` - Full path to the repository root directory

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

**Auto-push to remote and install dependencies:**
```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "main",
  "pushRemote": true,
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

## Architecture Overview

The codebase is organized into thin CLI adapters plus layered application modules:

- `src/commands/*`: user-facing command handlers for parsing options and printing output
- `src/app/*`: use cases and workflow orchestration
- `src/domain/*`: shared settings/worktree models and pure resolution logic
- `src/infra/*`: git access, storage, script execution, shell integration, and updater implementations
- `src/utils/*`: compatibility shims and small shared helpers

This keeps command files small while making git behavior, metadata handling, and update logic easier to test and evolve independently.

## Project Structure

```
wt/
├── src/
│   ├── index.ts              # Commander CLI entry point
│   ├── cli/
│   │   └── command-runtime.ts # Shared command error/exit handling
│   ├── commands/
│   │   ├── init.ts           # wt init
│   │   ├── new.ts            # wt new
│   │   ├── list.ts           # wt list / wt ls
│   │   ├── remove.ts         # wt remove / wt rm
│   │   ├── cd.ts             # wt cd
│   │   └── update.ts         # wt update
│   ├── app/
│   │   ├── repository-context.ts # Resolve repo root/name from current cwd
│   │   ├── worktree-catalog.ts   # Aggregate worktree info and status
│   │   └── use-cases/            # Command workflows
│   ├── domain/
│   │   ├── settings.ts       # Settings schema and normalization
│   │   ├── worktree.ts       # Worktree models and metadata helpers
│   │   └── worktree-target.ts # Worktree target resolution rules
│   ├── infra/
│   │   ├── git/              # Git repository/worktree/status access
│   │   ├── storage/          # Settings and metadata persistence
│   │   ├── scripts/          # Pre/post script execution
│   │   ├── shell/            # Shell cd handoff and wrapper updates
│   │   └── update/           # Release lookup and binary replacement
│   ├── config/
│   │   └── settings.ts       # Compatibility exports for settings access
│   ├── types/
│   │   └── index.ts          # Re-exported public TypeScript types
│   ├── utils/
│   │   ├── git.ts            # Compatibility shim for legacy git helpers
│   │   ├── script.ts         # Compatibility shim for script helpers
│   │   └── cd.ts             # Compatibility shim for shell cd handoff
├── shell/
│   ├── wt.zsh                # Zsh wrapper function
│   ├── wt.bash               # Bash wrapper function
│   └── wt.fish               # Fish wrapper function
├── .github/workflows/ci.yml  # CI checks
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
