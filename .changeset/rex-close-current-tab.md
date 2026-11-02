---
"@leesangb/wt": minor
---

Close the invoking Rex tab when removing the current worktree, including `wt rm .`. Resolve the tab from `REX_BLOCK` before removal and close it after foreground worktree removal succeeds or background removal starts. Keep the tab open when removing another worktree, when foreground worktree removal or background task startup fails, or when the invoking pane moves to another tab during removal. Background task failures after startup do not reopen the tab.
