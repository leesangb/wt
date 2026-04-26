# Worktree Rename Design

## Goal

Add `wt rename <new-id>` to change the current linked worktree's ID without moving the worktree directory.

## Behavior

- The command operates on the worktree containing the current working directory.
- The main worktree cannot be renamed.
- The new ID is trimmed and must not be empty.
- The command fails if the new ID would conflict with any other worktree's `id` or `fullId`.
- The command updates `.wt/meta.json`, preserving existing metadata such as base branch, base commit, creation time, and pull request fields.
- The worktree directory path is not changed.

## Architecture

- Add an app-layer use case that resolves the repository context, loads worktrees, identifies the current linked worktree, validates the new ID, reads existing metadata, and writes updated metadata.
- Add a command-layer wrapper for terminal output.
- Register `rename <new-id>` in the CLI entrypoint.

## Testing

- Add e2e coverage proving `wt rename` changes `WT_ID`/list/cd behavior while preserving the original path.
- Add e2e coverage proving rename rejects IDs already used by another worktree.
