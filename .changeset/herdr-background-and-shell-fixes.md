---
"@leesangb/wt": patch
---

Create Herdr worktrees in the background after the overlay exits, with separate creation and opening failure notifications, while preserving pull request workspace labels.

Keep local wt settings and generated files out of Git status using the repository's local exclude file instead of modifying tracked ignore rules.

Preserve the CLI script path when installing shell integration through a Bun executable named `bun.exe`.
