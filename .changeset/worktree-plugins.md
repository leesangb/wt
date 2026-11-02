---
"@leesangb/wt": minor
---

Add local JavaScript and TypeScript plugins for worktree opening and removal, with Herdr enabled as a built-in plugin. Load plugins from `.wt/plugins/` or the user configuration directory, provide typed hooks and shell context, and support per-plugin activation and `--no-open`.

Plugin failures produce warnings while worktree operations continue. Batch removal reports unresolved selectors first and removes the invoking checkout last to preserve its plugins and settings. Herdr UI actions skip automatic opening so each workspace is opened once.
