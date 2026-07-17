# @leesangb/wt

## 0.8.1

### Patch Changes

- 74a147d: Close the Herdr workspace associated with a worktree removed by `wt rm`, with a `herdr.closeWorkspaceOnRemove` setting to opt out. Herdr workspaces opened with `--no-cd` now preserve the current focus. Shell completion for `wt pr` now lists open GitHub pull requests.

## 0.8.0

### Minor Changes

- 7da27f8: Automatically open worktrees in Herdr when wt runs inside a managed pane, and add an action that opens all existing linked worktrees for the current repository.

### Patch Changes

- 8d9eec8: Align the Herdr pull request picker into terminal-width-aware columns and render draft status in gray.
- edbb354: add herdr integration

## 0.7.0

### Minor Changes

- b008002: Add a Herdr plugin that creates worktrees through `wt` and opens them as grouped Herdr workspaces. Add JSON output to `new`, `checkout`, and `pr` for integrations.
- 20a6ae4: macos27, herdr plugin
- 43d966b: Add fzf pickers for local branches and open pull requests in the Herdr plugin, including PR title, author, head branch, and draft status.
- ddd5930: Use fzf for Herdr worktree branch input and base-branch selection, with Escape cancelling either step.

## 0.6.0

### Minor Changes

- 206533a: Show configurable issue tracker links in wt list output

## 0.5.3

### Patch Changes

- 1ab8aeb: rename and rm current

## 0.5.2

### Patch Changes

- 0ab95b4: improve merge detection

## 0.5.1

### Patch Changes

- 30bb464: make clean interactive, add copy

## 0.5.0

### Minor Changes

- e34eb59: Fix Homebrew uninstall behavior, add a `wt uninstall` CLI command, and harden shell wrapper config cleanup during reinstall and removal.

## 0.4.0

### Minor Changes

- 6fc32dc: Add `wt clean` for previewable bulk cleanup of merged and remote-deleted worktrees.

## 0.3.1

### Patch Changes

- bec72c6: add homebrew

## 0.3.0

### Minor Changes

- 8e51125: update installation

## 0.2.7

### Patch Changes

- 5772f7c: fix wt pr

## 0.2.6

### Patch Changes

- 9d35105: add local setting override, wt checkout

## 0.2.5

### Patch Changes

- 942222f: loading spinner, error handling when rm

## 0.2.4

### Patch Changes

- a60d82d: noti before start, wt pr id

## 0.2.3

### Patch Changes

- d99b9a1: Mark the main worktree in `wt list` and `wt ls` output.

## 0.2.2

### Patch Changes

- efb2a6c: minor update

## 0.2.1

### Patch Changes

- 784cb10: add autocompletion for rm

## 0.2.0

### Minor Changes

- 3bf5ae0: refactor architecture

## 0.1.7

### Patch Changes

- b5944dc: Fix streams, improve worktrees listing perf

## 0.1.6

### Patch Changes

- 804efd9: async mode

## 0.1.5

### Patch Changes

- 8a06c5c: fix update script to update shell-integration

## 0.1.4

### Patch Changes

- 20ee02d: add update command

## 0.1.2

### Patch Changes

- 5ce4e14: initial release
