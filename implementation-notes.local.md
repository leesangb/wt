## 2026-07-22 Herdr worktree creation

- The Herdr overlay is the input process, so it must hand off a serialized creation request before any `wt` command starts. The detached child reuses the compiled `wt-herdr` binary and performs creation/opening after the overlay exits.
- Use `node:child_process.spawn` with `detached: true`, `stdio: "ignore"`, and `unref()` for this handoff. Bun's `spawn` has `unref()` but no typed `detached` option, while the existing repository already uses Node's detached-process pattern.
- Creation runs with captured `wt` output (the overlay is already closed), preserving the final JSON parser while allowing stderr text to reach failure notifications.
- The detached handoff waits only for Node's `spawn`/`error` launch handshake. This catches a missing executable or cwd without waiting for the child command, and the child remains independent after `unref()`.
- The start notification is deliberately fire-and-forget because the Herdr CLI is auxiliary; awaiting it could delay the actual `wt` operation even though the overlay has already closed. Creation and Herdr opening have separate failure notifications so an already-created worktree is never reported as missing.
