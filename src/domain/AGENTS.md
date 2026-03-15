# Domain Layer

## Scope
This directory contains product rules, value models, and deterministic resolution logic.

## Responsibilities
- Define shared models such as settings, worktree metadata, and target identifiers.
- Normalize and validate user-configurable values.
- Hold pure rules for deriving names, ids, paths, and similar values.
- Provide deterministic helpers that can be reused by app and infra.

## Do
- Keep functions pure whenever possible.
- Prefer explicit input/output types and predictable return values.
- Encode rules that should remain stable regardless of CLI, git adapter, or storage details.
- Write unit tests here when behavior can be verified without a repository or external process.

## Do Not
- Do not read or write files.
- Do not run git commands, subprocesses, network calls, or shell integration.
- Do not depend on `src/app/*`, `src/commands/*`, or `src/infra/*`.
- Do not inspect `process.cwd()`, environment-dependent state, or terminal output.
- Do not hide side effects behind "helper" APIs.

## Dependencies
- Domain should depend only on other domain modules and deterministic standard library utilities.
- Avoid Bun- or Node-specific side-effect APIs in this layer.
- If a function needs repository IO to answer a question, it does not belong here.

## Placement Guide
- Put code here when the main question is "what is the correct value or rule?"
- If the question is "how do we execute this workflow?", it belongs in app.
- If the question is "how do we talk to git, disk, network, or shell?", it belongs in infra.

## Repo-Specific Examples
- `settings.ts` should own defaults and normalization rules.
- `worktree.ts` should own stable model shapes and identifier derivation.
- `worktree-target.ts` should resolve and interpret target selectors without touching git or disk.
