# wt - Git Worktree Manager

A CLI tool to manage git worktrees with pre/post script support.

## Features

- 🚀 Create worktrees with UUID-based directories
- ⚙️ Configure worktree base directory and scripts per repository
- 🎯 Pre/post script execution for automation with environment variables
- 📦 Fast and lightweight
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
  "scripts": {
    "pre": [],
    "post": []
  }
}
```

### Create a new worktree

```bash
wt new feature-branch --base main
```

This will:
1. Run the pre scripts (if configured)
2. Create a worktree at `~/.wt/<uuid>` with branch `feature-branch`
3. Run the post scripts in the new worktree (if configured)
4. Display the path to navigate to

### List all worktrees

```bash
wt list
# or
wt ls
```

### Remove a worktree

```bash
wt remove <uuid>
# or
wt rm <uuid>
```

## Configuration

Edit `.wt/settings.json` in your repository:

- **worktreeDir**: Base directory for worktrees (default: `~/.wt`)
- **scripts.pre**: Array of commands to run before creating worktree
- **scripts.post**: Array of commands to run after creating worktree (runs in new worktree directory)

### Environment Variables

Scripts have access to these environment variables:

- `$WT_PATH` - Full path to the worktree directory
- `$WT_ID` - UUID of the worktree
- `$WT_BRANCH` - Branch name

### Example configurations

**Install dependencies after creating worktree:**
```json
{
  "worktreeDir": "~/.wt",
  "scripts": {
    "pre": [],
    "post": ["npm install"]
  }
}
```

**Fetch latest, install dependencies, and open in VS Code:**
```json
{
  "worktreeDir": "~/.wt",
  "scripts": {
    "pre": ["git fetch"],
    "post": ["npm install", "code $WT_PATH"]
  }
}
```

**Multiple sequential commands:**
```json
{
  "worktreeDir": "~/projects/worktrees",
  "scripts": {
    "pre": [
      "git fetch origin",
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
│   │   └── uuid.ts           # UUID generation
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
