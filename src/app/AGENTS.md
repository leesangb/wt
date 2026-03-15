# App Layer

## Scope
This directory contains use cases and workflow orchestration for the product.

## Responsibilities
- Define application-level operations such as creating, listing, removing, and resolving worktrees.
- Coordinate domain logic with infra adapters.
- Resolve repository context and assemble the data needed by commands.
- Return structured results that commands can print.
- Own cross-adapter workflow order, validation, and failure propagation.

## Do
- Orchestrate multi-step flows that touch git, settings, metadata, scripts, or shell integration.
- Keep use cases focused on a single user intention.
- Prefer explicit input and result types for each use case.
- Centralize workflow rules that must stay consistent across multiple commands.
- Translate raw adapter responses into application-shaped results.

## Do Not
- Do not print to the console or format terminal-specific strings here.
- Do not call `process.exit()` or assume interactive terminal behavior.
- Do not embed raw git command details, file layout assumptions, or HTTP request logic here when those can live in infra adapters.
- Do not put pure value rules here if they can live in domain.
- Do not let one use case reach across multiple unrelated concerns without a clear user-facing workflow reason.

## Dependencies
- Allowed: `src/domain/*`, `src/infra/*`, `src/app/*` helpers.
- Not allowed: imports from `src/commands/*`.
- App is the boundary that composes domain rules with infra side effects.

## Placement Guide
- Put code here when it answers "what steps should happen for this user action?"
- If the logic is pure, reusable, and side-effect free, move it to `src/domain`.
- If the logic is about talking to git, the file system, shell wrappers, or release APIs, move it to `src/infra`.

## Repo-Specific Examples
- `use-cases/create-worktree.ts` should decide the order of fetch, pre-scripts, git worktree creation, metadata writes, and post-scripts.
- `worktree-catalog.ts` may assemble worktree state for listing, but detailed git/status operations should stay in infra.
- `repository-context.ts` is app-level because it supports use cases, not terminal formatting.
