# wt - Git Worktree Manager

A CLI tool to manage git worktrees with pre/post script support.

## Features

- 🚀 Create worktrees with short IDs and repo-based naming
- ⚙️ Configure worktree base directory, base branch, and remote push behavior per repository
- 🔄 Auto-fetch latest changes before creating worktree
- 📤 Auto-push new branch to remote (configurable)
- 🎯 Pre/post script execution for automation with environment variables
- 📦 Fast and lightweight (works with both Node.js and Bun)
- 🎨 Colored CLI output for better UX

## Installation

### Via npm (recommended)

```bash
npm install -g @leesangb/wt
```

### Via binary

Download the latest binary from [GitHub Releases](https://github.com/leesangb/wt/releases) and add to your PATH.

### From source

```bash
git clone https://github.com/leesangb/wt.git
cd wt
bun install
bun run build
npm link
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
# Use default base branch (from settings or "main")
wt new feature-branch

# Specify base branch
wt new feature-branch --base develop

# Skip pushing to remote
wt new feature-branch --no-push-remote
```

This will:
1. Fetch the latest changes from remote (`git fetch`)
2. Run the pre scripts (if configured)
3. Create a worktree at `~/.wt/<reponame-shortid>` with branch `feature-branch`
4. Push the new branch to remote (if enabled)
5. Run the post scripts in the new worktree (if configured)
6. Display the worktree path

**Options:**
- `--base <branch>` - Base branch to create from (default: from settings or `main`)
- `--no-push-remote` - Skip pushing the new branch to remote

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
├── package.json
└── tsconfig.json
```

## Development

```bash
# Run in development mode
bun run dev

# Build for npm distribution
bun run build

# Build standalone binary
bun run build:binary
```

## License

MIT
