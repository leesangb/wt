---
"@leesangb/wt": minor
---

Add a built-in Rex plugin that opens worktrees from `wt new`, `wt pr`, and `wt checkout` in a new tab in the current Rex session. Focus the new tab by default, preserve focus with `--no-cd`, and support `--no-open` and `plugins.rex: false`. Rex tabs are not reused or closed when a worktree is removed.
