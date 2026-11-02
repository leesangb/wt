---
"@leesangb/wt": patch
---

Select the newly opened Rex tab in the connected app after creating a worktree. Server-side focus alone did not switch the visible tab. Preserve the current selection with `--no-cd`, and report selection failures before falling back to shell navigation.
