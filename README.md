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

### Install with Homebrew

```bash
brew install leesangb/cli/wt
```

Homebrew installs can add optional shell integration with:

```bash
wt shell install zsh
```

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
- Generate shell wrapper scripts in `~/.wt/shell/`
- Automatically add shell wrapper source lines to your shell config files (`.zshrc`, `.bashrc`, or `config.fish`)
- Set up auto-cd functionality

After installation, restart your shell or run:
```bash
source ~/.zshrc  # or ~/.bashrc or ~/.config/fish/config.fish
```

### Manual Shell Integration (Optional)

If you prefer manual setup or want to regenerate shell integration for a specific binary path, run `wt shell install <shell>` and source the generated wrapper from `~/.wt/shell/`:

#### Zsh (~/.zshrc)

```bash
wt shell install zsh
source ~/.wt/shell/wt.zsh
```

#### Bash (~/.bashrc)

```bash
wt shell install bash
source ~/.wt/shell/wt.bash
```

#### Fish (~/.config/fish/config.fish)

```fish
wt shell install fish
source ~/.wt/shell/wt.fish
```

**Note:** `wt shell install <shell>` writes a wrapper to `~/.wt/shell/` and embeds the command used to launch `wt`.
If you want to pin a specific executable path, pass `--binary-path <path>`. If that path changes later, run the command again to regenerate the wrapper.

### Uninstallation

```bash
# Installed wt (standalone or Homebrew)
wt uninstall

# Source checkout helper
./uninstall.sh

# `wt uninstall` will:
# - Remove the active standalone wt binary, or delegate to `brew uninstall wt`
# - Remove shell wrapper scripts from ~/.wt/shell/
# - Remove source lines from shell config files
```

**Note:** The uninstallation script does not remove worktrees or repository-specific `.wt/settings.json` / `.wt/settings.local.json` files. To fully clean up, manually run:
```bash
rm -rf ~/.wt/  # Remove all worktrees and shell scripts
```

### Without Shell Integration

If you don't set up the shell wrapper, you can use `--no-cd` flag:

```bash
wt new feature-branch --no-cd
wt checkout feature-branch --no-cd
wt pr 123 --no-cd
# Then manually: cd /path/shown/in/output
```

## Usage

**Note:** You can run `wt` from any directory inside a git repository. Commands resolve the repository root internally, while relative `worktreeDir` values in `.wt/settings.json` and `.wt/settings.local.json` are interpreted relative to the repository root.

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
  "copy": {
    "include": [],
    "exclude": []
  },
  "scripts": {
    "pre": [],
    "post": [],
    "postMode": "async"
  }
}
```

`wt init` also writes `settings.local.json` to `.wt/.gitignore` so local overrides stay untracked by default without touching the repository root `.gitignore`.

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
5. Copy configured local files into the new worktree (if configured)
6. Run the post scripts in the new worktree (if configured)
7. Automatically change to the new worktree directory (with shell wrapper)

When post scripts run in async mode, `wt` returns immediately and writes status/log files under `<worktree>/.wt/` (`post-task.json`, `post-task.log`). On macOS, `wt` also sends Notification Center notifications when the async task starts and when it finishes. Notification delivery failures are ignored.

By default, `WT_ID` uses the branch name. When the branch contains `/`, the worktree directory name replaces it with `-`, while the stored ID remains unchanged. For example, `feature/issue-12` becomes `~/.wt/<reponame-feature-issue-12>`. If that sanitized path is already taken by another worktree ID, `wt` appends a short suffix to keep the directory unique.

**Options:**
- `--base <branch>` - Base branch to create from (default: from settings or `main`)
- `--id <id>` - Override the default worktree ID (defaults to the branch name)
- `--no-push` - Skip pushing the new branch to remote
- `--no-cd` - Don't output cd command (for direct binary usage without shell wrapper)

### Create or navigate to a local branch worktree

```bash
# Create a new worktree for an existing local branch or jump to one that's already open
wt checkout feature-branch

# Alias
wt switch feature-branch

# Direct binary usage without auto-cd
wt checkout feature-branch --no-cd
```

This command:
1. Checks whether any existing worktree is already on that local branch
2. Navigates to that worktree immediately when it exists
3. Otherwise creates a fresh worktree for the existing local branch

`wt checkout` requires the branch to already exist locally. If you want to create a new branch first, use `wt new <branch>`.
The worktree ID defaults to the branch name. If that ID is already in use by another worktree, `wt checkout` appends `-1`, `-2`, and so on to keep the new ID unique and prints the adjustment in the CLI output.

### Create or navigate to a pull request worktree

```bash
# Create a new PR worktree or jump to an existing worktree for that PR head branch
wt pr 123

# Direct binary usage without auto-cd
wt pr 123 --no-cd
```

This command:
1. Loads the PR's base branch and head branch from GitHub CLI
2. Checks whether any existing worktree is already on that PR head branch
3. Navigates to that worktree immediately when it exists
4. Otherwise creates a fresh worktree with ID/path based on `pr-<number>` and checks out the PR with `gh pr checkout`

`wt pr` still checks out the PR's actual head branch instead of creating a synthetic local branch like `pr-123`, so it always requires GitHub CLI (`gh`) to resolve the PR details first.
The worktree ID and directory name are based on the PR number (`pr-123`). If that ID is already in use, `wt pr` appends `-1`, `-2`, and so on to keep the new ID unique and prints the adjustment in the CLI output.

### Update wt

If `wt` was installed with Homebrew, `wt update` delegates to Homebrew automatically:

```bash
wt update
# runs: brew upgrade wt
```

For Homebrew installs, `--force` becomes a reinstall:

```bash
wt update --force
# runs: brew reinstall wt
```

Standalone binary installs can update to the latest release directly (macOS only for now):
```bash
wt update
```

Standalone binary installs can also force a re-download of the current version:
```bash
wt update --force
```

Install a specific version for standalone binary installs:
```bash
wt update --version 0.1.2
```

Skip removing quarantine attribute for standalone binary installs:
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
wt remove <id...>
# or
wt rm <id...>
```

If the worktree has modified files or unpushed commits, `wt rm` asks for confirmation before deleting it. When you pass multiple worktrees, it prompts separately for each one. Use `wt rm <id...> --force` to skip the prompts.

You can remove a worktree using:
- ID (defaults to the branch name, e.g., `feature/issue-12`)
- Full ID with repo prefix (e.g., `myrepo-feature/issue-12`)
- Any part of the path that uniquely identifies the worktree

### Clean up matching worktrees

```bash
wt clean
wt clean -m
wt clean -d --dry
wt clean -m -d --keep-branch
```

`wt clean` always opens an interactive picker. Cleanup filters preselect matching worktrees, and without filters it shows all non-main worktrees:

- `-m`, `--merged`: include worktrees whose branches are already merged into their base branch
- `-d`, `--remote-deleted`: include worktrees whose configured upstream branch is gone on the remote

Before removing anything, `wt clean` prints a preview of the selected worktrees and asks for confirmation. Use `--dry` to preview only, or `-f`, `--force` to skip the preview confirmation and any pending-change prompts. `wt clean` requires an interactive terminal because selection always happens in the picker. `--remote-deleted` only matches branches with a gone upstream, so local branches that were never pushed are not treated as deleted remotes.

## Configuration

Edit `.wt/settings.json` in your repository:

- **worktreeDir**: Base directory for worktrees (default: `~/.wt`)
- **baseBranch**: Default base branch for new worktrees (default: `main`)
- **pushRemote**: Auto-push new branch to remote (default: `true`)
- **copy.include**: Glob patterns to copy from the repository root into each new worktree
- **copy.exclude**: Glob patterns to remove from `copy.include`
- **scripts.pre**: Array of commands to run before creating worktree (runs in repo root)
- **scripts.post**: Array of commands to run after creating worktree (runs in new worktree directory)
- **scripts.postMode**: `async` (default) or `sync` for foreground execution

You can also add an optional `.wt/settings.local.json` for user- or machine-local overrides. `wt` loads `.wt/settings.json` first, then applies `.wt/settings.local.json` on top of it. Nested `copy.*` and `scripts.*` fields are merged, so you can override only `copy.exclude` or `scripts.postMode` without copying the rest of each object.

`copy.include` and `copy.exclude` are resolved relative to the repository root. If a pattern names a directory without `/**` (for example `.wt` or `apps/web`), `wt` treats it as the whole subtree for both include and exclude rules. `wt` only copies files that are not tracked by git, since tracked files are already populated by the worktree checkout. It always skips `.git`, `node_modules`, and directories currently ignored by `.gitignore`. Internal reserved files under `.wt/` such as `meta.json`, `.gitignore`, and async post-task state remain managed by `wt`.

Example `.wt/settings.local.json`:

```json
{
  "copy": {
    "exclude": ["dist", ".wt/settings.json"]
  },
  "baseBranch": "develop",
  "scripts": {
    "postMode": "sync"
  }
}
```

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
  "copy": {
    "include": [],
    "exclude": []
  },
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
  "copy": {
    "include": [],
    "exclude": []
  },
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
  "copy": {
    "include": [],
    "exclude": []
  },
  "scripts": {
    "pre": [],
    "post": ["npm install", "code $WT_PATH"]
  }
}
```

**Copy local env files and local wt overrides into each worktree:**
```json
{
  "worktreeDir": "~/.wt",
  "baseBranch": "main",
  "pushRemote": true,
  "copy": {
    "include": [".env", ".env.local", ".wt/settings.local.json", "apps/web"],
    "exclude": [".wt/settings.json", "dist"]
  },
  "scripts": {
    "pre": [],
    "post": []
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
│   │   ├── pr.ts             # wt pr
│   │   ├── list.ts           # wt list / wt ls
│   │   ├── remove.ts         # wt remove / wt rm
│   │   ├── clean.ts          # wt clean
│   │   ├── cd.ts             # wt cd
│   │   ├── shell.ts          # wt shell install
│   │   └── update.ts         # wt update
│   ├── app/
│   │   ├── repository-context.ts # Resolve repo root/name from current cwd
│   │   ├── worktree-creation.ts  # Shared creation helpers and script hooks
│   │   ├── worktree-catalog.ts   # Aggregate worktree info and status
│   │   └── use-cases/            # Command workflows
│   ├── domain/
│   │   ├── settings.ts       # Settings schema and normalization
│   │   ├── shell.ts          # Supported shell types
│   │   ├── worktree.ts       # Worktree models and metadata helpers
│   │   └── worktree-target.ts # Worktree target resolution rules
│   ├── infra/
│   │   ├── git/              # Git repository/worktree/status access
│   │   ├── github/           # GitHub CLI integration for PR checkout
│   │   ├── storage/          # Settings and metadata persistence
│   │   ├── scripts/          # Pre/post script execution
│   │   ├── shell/            # Shell cd handoff and wrapper generation
│   │   └── update/           # Release lookup and binary replacement
│   ├── config/
│   │   └── settings.ts       # Compatibility exports for settings access
│   ├── types/
│   │   └── index.ts          # Re-exported public TypeScript types
│   ├── utils/
│   │   ├── git.ts            # Compatibility shim for legacy git helpers
│   │   ├── script.ts         # Compatibility shim for script helpers
│   │   └── cd.ts             # Compatibility shim for shell cd handoff
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
