---
"@leesangb/wt": minor
---

Support `.worktreeinclude` at the repository root as a fallback for copying local files into new worktrees. Patterns use Git's `.gitignore` syntax and select only gitignored files. Explicit `copy` settings in `.wt/settings.json` or `.wt/settings.local.json` take precedence, including empty settings.
