# Commands Layer

## Scope
This directory contains user-facing CLI command handlers.

## Responsibilities
- Parse CLI arguments and flags into explicit inputs for the application layer.
- Call app-layer use cases and await their results.
- Render human-readable output for terminal users.
- Map failures to CLI behavior through shared command runtime helpers.
- Keep command files thin and easy to scan.

## Do
- Prefer one command file per top-level CLI command.
- Treat command functions as adapters from `commander`-style input to app use cases.
- Keep output formatting local to this layer.
- Use shared CLI/runtime helpers such as `runCommand` for error handling and exit behavior.
- Return early once output is printed; avoid extra branching that belongs in app logic.

## Do Not
- Do not call git, file system, network, or child-process APIs directly.
- Do not import from `src/infra/*` for core behavior.
- Do not encode worktree rules, settings defaults, merge logic, or path resolution here.
- Do not mutate repository state outside of app use cases.
- Do not call `process.exit()` directly from commands unless the command runtime contract explicitly requires it.

## Dependencies
- Allowed: `src/app/*`, `src/cli/*`, small generic helpers that do not bypass app workflows.
- Avoid: `src/infra/*` and low-level platform APIs.
- Commands may depend on domain-shaped result types indirectly through app return values, but they should not bypass app orchestration.

## Placement Guide
- Put a file here when the main job is "parse terminal input and print terminal output."
- If the code decides how a workflow runs across git, storage, or scripts, it belongs in `src/app`.
- If the code talks to git, disk, network, or shell wrappers, it belongs in `src/infra`.

## Repo-Specific Examples
- `list.ts` should decide how to print completion lines vs. full terminal output.
- `new.ts` should not decide how worktree paths are resolved or when scripts run.
- `update.ts` may print warnings from shell integration updates, but the update workflow belongs in app/infra.
