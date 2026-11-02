# wt - Git Worktree Manager

English | [한국어](./README.ko.md)

A CLI tool to manage git worktrees with pre/post script support.

## Features

- 🚀 Create worktrees with branch-based IDs and repo-based naming
- 🎯 Auto-cd to new worktree (with shell wrapper integration)
- ✏️ Rename a worktree ID without moving its directory
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

### Herdr plugin

The repository also ships a first-class [Herdr](https://herdr.dev) plugin. It
creates worktrees with `wt`, then opens them with Herdr's worktree API so they
appear as grouped worktree workspaces under the source repository.

```bash
wt herdr install
```

This delegates to `herdr plugin install leesangb/wt`.

The plugin provides these actions:

- `wt.herdr.new` — create a new branch worktree
- `wt.herdr.checkout` — open an existing local branch as a worktree
- `wt.herdr.pr` — create or reuse a pull request worktree
- `wt.herdr.open-all` — open every existing checkout that is not already open
- `wt.herdr.open-pr` — open the selected Space's pull request in a browser
- `wt.herdr.watch-pr` — start live pull request status for an existing Space

The new-worktree action uses a text prompt for the new branch and `fzf` for the
base branch. Checkout lists local branches, while PR lists open GitHub pull
requests with title, author, head branch, and draft status. Press `Esc` at any
step to cancel. In the base-branch picker, an exact existing ref such as
`origin/main` is accepted even when it does not match the displayed choices.
The plugin requires `fzf` on `PATH`, and the PR picker requires an authenticated
GitHub CLI (`gh`).

Newly opened worktree Spaces automatically watch their linked pull request and
CI status. Add the metadata tokens to the expanded Space rows:

```toml
[ui.sidebar.spaces]
rows = [
  ["state_icon", "workspace"],
  ["branch", "git_status"],
  ["$diff"],
  ["$pr", "$ci"],
]
```

`$diff` shows tracked line changes and untracked file counts, for example
`+24 -7 ?2`. It refreshes immediately when a Space is focused, every 30
seconds while focused, and every five minutes in the background.
Pull requests appear as `🟢 #123` when open, `⚪ #123` when draft,
`🟣 #123` when merged, and `🔴 #123` when closed. CI is reduced to `✅`,
`🟡`, or `❌`. Run `wt.herdr.watch-pr` once for a Space that was already open
when the plugin was installed or the Herdr server restarted. Pending checks use
GitHub CLI's watch mode and update as soon as they finish. Focusing a Space
refreshes it immediately; stable states use a five-minute safety refresh, and
stale values expire during an outage.

These intervals can be customized with `herdr.refresh` settings. Values are in
seconds; focused, background, and pull request refreshes have safe minimums of
5, 30, and 60 seconds respectively. Settings are re-read while watchers run,
and focusing a Space always triggers an immediate refresh.

Herdr metadata tokens are display-only, so open the selected Space's pull
request with the `wt.herdr.open-pr` action. You can optionally bind it directly:

```toml
[[keys.command]]
key = "prefix+alt+o"
type = "plugin_action"
command = "wt.herdr.open-pr"
description = "Open this Space's pull request"
```

When `wt new`, `wt checkout`, or `wt pr` runs inside a Herdr pane, `wt`
automatically opens the resulting checkout as a focused Herdr worktree workspace.
Pass `--no-cd` to open the workspace without moving focus to it.
Outside Herdr, the existing shell auto-`cd` behavior is unchanged.
This integration is the built-in `herdr` plugin, enabled by default. Set
`"plugins": { "herdr": false }` to disable automatic opening and closing, or
pass `--no-open` to skip opening plugins for one `new`, `checkout`, or `pr` command.
The Herdr UI plugin above is installed separately; its actions open their own
workspace and invoke `wt --no-open` to avoid opening it twice.

For example, replace Herdr's default new-worktree binding with the `wt` flow:

```toml
[[keys.command]]
key = "prefix+shift+g"
type = "plugin_action"
command = "wt.herdr.new"
description = "Create worktree with wt"
```

Reload the configuration after editing it:

```bash
herdr server reload-config
```

The installed plugin builds and uses the `wt` source from the same revision, so
it does not depend on a separately installed `wt` binary. It requires Herdr
`>= 0.7.4` and Bun during plugin installation.

### Rex integration

The built-in `rex` plugin is enabled by default. Inside a Rex terminal,
`wt new`, `wt pr`, and `wt checkout` open the resulting worktree in a new tab
in the session identified by `REX_SESSION`, then focus that tab. The original
shell stays in its current directory. The `rex` CLI must be available on `PATH`.

```bash
wt new feature/login
wt pr 123
wt pr 123 --no-cd   # Open a background tab without moving focus
```

Use `--no-open` to skip opening a tab for one command, or set
`"plugins": { "rex": false }` to disable the integration. Outside Rex, it does
nothing. If Rex cannot open the tab, `wt` prints a warning and falls back to
normal shell navigation.

Each invocation opens a fresh tab, including when the worktree already exists.
This plugin does not create Rex sessions or reuse tabs. PR tabs use the PR
display label, trimmed to Rex's 128-character label limit.

Removing the invoking worktree with `wt rm .` (or its ID) also closes the tab
containing `REX_BLOCK`, including its panes. Foreground removal closes it after
the worktree is removed; background removal closes it as soon as the removal
task starts, even if that task later fails. The tab stays open if foreground
worktree removal or background task startup fails. Removing another worktree
does not close the invoking tab. Closing requires a valid `REX_BLOCK`. Before
closing, the plugin rechecks which tab contains that pane and skips closing if
the lookup fails or reports a different tab. Disable the `rex` plugin to turn
off both automatic opening and closing.

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

`wt init` adds wt's machine-local settings and task artifacts to the repository-local `.git/info/exclude`, so they stay untracked without modifying any committed `.gitignore` file.

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

With shell integration installed, press `Tab` after `wt pr ` to complete from
open GitHub pull requests. Zsh and Fish also show the PR title, author, branch,
and draft status in the completion menu.

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

If the `wt.herdr` plugin was installed from `leesangb/wt`, `wt update` also
syncs it to the same release tag. Locally linked plugins and plugins from other
repositories are left unchanged. Use `wt update --force` to reinstall an
already matching plugin version.

### List all worktrees

```bash
wt list
# or
wt ls
```

### Rename the current worktree ID

```bash
wt rename new-name
```

`wt rename` updates the ID for the worktree containing your current directory. It does not move or rename the worktree directory. The new ID must be unique across the repository's worktrees, and the main worktree cannot be renamed.

### Remove a worktree

```bash
wt remove <id...>
# or
wt rm <id...>
```

If the worktree has modified files or unpushed commits, `wt rm` asks for confirmation before deleting it. When you pass multiple worktrees, it prompts separately for each one. Use `wt rm <id...> --force` to skip the prompts.

When removing the worktree that contains your current directory, `wt rm` starts the removal in the background and immediately returns your shell to the main worktree. It prints the background task PID plus status and log file paths under the main worktree's `.wt/` directory. On macOS, Notification Center reports whether the background removal finished or failed. Use `wt rm . --foreground` if you want to wait for removal before returning.

When run inside Herdr, `wt rm` also closes the Herdr workspace associated with the removed worktree. For background removal, the workspace closes as soon as the removal task starts; it does not wait for that task to finish. Set `herdr.closeWorkspaceOnRemove` to `false` to keep it open.

You can remove a worktree using:
- ID (defaults to the branch name, e.g., `feature/issue-12`)
- Full ID with repo prefix (e.g., `myrepo-feature/issue-12`)
- Any part of the path that uniquely identifies the worktree
- `.` to remove the worktree containing your current directory

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

## Custom plugins

Put a JavaScript or TypeScript file in `.wt/plugins/` for the current repository,
or `~/.config/wt/plugins/` for every repository (`$XDG_CONFIG_HOME/wt/plugins/`
when set). No registration or separate runtime is needed, including when using
the standalone `wt` binary. The files execute as your user, just like configured
pre/post scripts; only add plugins you trust.

For example, `.wt/plugins/editor.ts` can open worktrees in your editor:

```ts
export default ({ env, $ }) => {
  if (env.WT_EDITOR !== "code") return {};

  return {
    "worktree.open": async ({ path, focus }) => {
      if (!focus) return;
      await $`code --new-window ${path}`;
      return "handled";
    },
  };
};
```

Run `WT_EDITOR=code wt checkout feature/login`. The hook runs for both newly
created and reused worktrees. Returning `"handled"` suppresses shell auto-`cd`;
returning `"skipped"` or nothing tries the next plugin, then falls back to shell
navigation. `--no-cd` passes `focus: false` and disables shell navigation.
`--no-open` skips opening plugins entirely. `--json` only changes output format;
it does not skip hooks.

Plugin ids are filenames without their extension, so this file's id is `editor`.
Set `"plugins": { "editor": false }` in any settings file to disable it **before
it is imported**. Project plugins run first, then global plugins, then builtins.
Files within a directory run in filename order. The first file for each id wins,
so a project `editor.ts` replaces a global `editor.js`, and `herdr.ts` can replace
the builtin. The first open hook that returns `"handled"` stops the open chain.
Builtins run in `herdr`, then `rex` order if both environments are present.

Each file default-exports a factory (sync or async) returning a hooks object.
Its context contains `repoRoot`, `cwd`, `env`, `settings`, and `$`:

- `repoRoot` is the invoking checkout; project plugins are discovered there.
- `cwd` is the working directory for shell commands. During removal it is a
  surviving checkout, so callbacks can run after the target directory is gone.
- `env` is the inherited environment without the shell wrapper's `WT_SHELL_CD_FILE`.
- `settings` is the merged configuration, including existing `herdr.*` options.
- `$` runs Bun shell commands with this cwd and environment. Output is captured
  by default; use `.text()` or `.json()` to read it. Report plugin logs to stderr,
  for example with `console.error`, to keep `--json` output usable.

Supported hooks:

| Hook | Input | Return |
| --- | --- | --- |
| `worktree.open` | `{ id, path, branch, label, focus }` | `"handled"`, `"skipped"`, or nothing |
| `worktree.remove.before` | `{ id, path, branch? }` | An optional callback receiving the removal outcome |

Both hooks and the removal callback may be async. A removal hook can keep
provider-specific state in its callback closure:

```ts
export default ({ $ }) => ({
  "worktree.remove.before": async ({ path }) => {
    const label = (await $`git -C ${path} branch --show-current`.text()).trim();

    return ({ status }) => {
      console.error(`${label}: ${status}`);
    };
  },
});
```

Removal hooks run after confirmation and plan revalidation, including removals
through `wt clean`. Batch removal keeps the current checkout until last, so its
local plugins and settings remain available for every target. Each returned
callback runs after one of these outcomes:

- `{ status: "removed", branchDeleted }`: foreground worktree removal succeeded.
- `{ status: "worktree_removed_branch_failed", error }`: the worktree was removed,
  but deleting its branch failed.
- `{ status: "background_started", pid }`: the background task started; this is
  **not** a notification that deletion finished.

Callbacks do not run when Git worktree removal or background task startup fails.
Plugin loading, hook, and callback errors produce warnings and allow other
plugins and the worktree operation to continue. These hooks are for integration
effects, not for vetoing Git operations. Existing `scripts.pre` / `scripts.post`
remain creation setup scripts and do not run for reused worktrees.

For optional editor type checking, a project with the `@leesangb/wt` package
available can `import type { Plugin } from "@leesangb/wt/plugin"` and use
`const plugin: Plugin = (context) => ({ ... })`. Types are in [src/plugin.ts](src/plugin.ts).
Plugins can use Bun/Node builtins and locally installed dependencies; `wt` does
not download npm packages or install dependencies automatically.

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
- **plugins**: Plugin ids mapped to `true` or `false`; unspecified plugins, including built-in `herdr` and `rex`, are enabled
- **herdr.closeWorkspaceOnRemove**: Close the associated Herdr workspace after `wt rm` (default: `true`)
- **herdr.refresh.focusedSeconds**: Git diff refresh interval for a focused Herdr Space (default: `30`, minimum: `5`)
- **herdr.refresh.backgroundSeconds**: Git diff refresh interval for a background Herdr Space (default: `300`, minimum: `30`)
- **herdr.refresh.pullRequestSeconds**: Safety refresh interval for stable pull request and CI status (default: `300`, minimum: `60`)
- **issue.pattern**: Optional JavaScript regular expression for extracting issue keys from branch names
- **issue.url**: Optional issue tracker URL template. Use `$issue` where the extracted key should appear

Settings are loaded in this order, with later values taking precedence:

1. `~/.config/wt/settings.json` for global **plugin switches only** (or `$XDG_CONFIG_HOME/wt/settings.json`).
2. `.wt/settings.json` in the repository from which `wt` is invoked.
3. `.wt/settings.local.json` for unshared repository overrides.

Repository overrides merge nested `copy.*`, `scripts.*`, `plugins.*`, `herdr.*`, and `issue.*` fields, so you can override one plugin switch or `herdr.closeWorkspaceOnRemove` without copying the remaining settings. The global file reads only `plugins`; other fields remain repository settings. `wt init` still writes only repository settings.

`copy.include` and `copy.exclude` are resolved relative to the repository root. A leading `./` is optional, so `./apps` and `apps` mean the same thing. If a pattern names a directory without `/**` (for example `.wt` or `apps/web`), `wt` treats it as the whole subtree for both include and exclude rules. `wt` only copies files that are untracked in the source repo, and it will not overwrite files already tracked in the newly created worktree. It always skips `.git`, `node_modules`, and directories currently ignored by `.gitignore`. Internal reserved files under `.wt/` such as `meta.json`, `.gitignore`, and async post-task state remain managed by `wt`.

If no settings file defines `copy`, `wt` uses `.worktreeinclude` at the source repository root:

```gitignore
# Local files needed by each worktree
.env
.env.*
!.env.example
config/secrets/
```

`.worktreeinclude` uses Git's `.gitignore` syntax, including comments, negation, root-anchored paths, and directory patterns. Only matching files that Git ignores are copied, including files inside ignored directories. Tracked files in either source or target are protected, and `.git`, `node_modules`, linked worktrees, and reserved `.wt` files are still skipped. The pattern file itself may be committed, untracked, or ignored.

Explicit `copy` settings take precedence over `.worktreeinclude`; the two sources are not combined. Existing local overrides still apply over shared settings. Even `"copy": { "include": [] }`, `"copy": {}`, or the legacy `"copy": []` disables the fallback. Other settings, such as `scripts` or `baseBranch`, do not disable it. If `.worktreeinclude` is absent or has no matching files, nothing is copied.

When `issue` is configured, `wt list` / `wt ls` matches `issue.pattern` against each branch name. If the pattern has a capture group, the first group becomes the issue key; otherwise the full match is used. The URL is printed as a clickable terminal link where supported:

```json
{
  "issue": {
    "pattern": "[A-Z]+-\\d+",
    "url": "https://myissues.com/$issue"
  }
}
```

Example `.wt/settings.local.json`:

```json
{
  "copy": {
    "exclude": ["dist", ".wt/settings.json"]
  },
  "baseBranch": "develop",
  "scripts": {
    "postMode": "sync"
  },
  "herdr": {
    "closeWorkspaceOnRemove": false,
    "refresh": {
      "focusedSeconds": 15,
      "backgroundSeconds": 600,
      "pullRequestSeconds": 600
    }
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
│   │   ├── rename.ts         # wt rename
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

Use Bun 1.4.4, declared in `package.json` under `packageManager`, for local
development and builds. CI and release workflows read the same version.

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
