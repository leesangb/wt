# Infra Layer

## Scope
This directory contains adapters for external systems and side-effecting implementation details.

## Responsibilities
- Encapsulate git commands, storage access, script execution, shell integration, and release/update IO.
- Expose focused APIs that app use cases can compose.
- Hide platform-specific details such as file paths, process spawning, HTTP requests, and external command output formats.
- Keep external integrations replaceable and testable.

## Do
- Group adapters by external concern, such as `git`, `storage`, `scripts`, `shell`, or `update`.
- Keep each adapter API narrow and explicit.
- Return structured data instead of terminal-formatted strings where possible.
- Contain side effects and platform quirks inside this layer.
- Add tests here when behavior depends on adapter contracts or failure modes.

## Do Not
- Do not print user-facing CLI output from infra modules.
- Do not decide top-level user workflows that span multiple adapters unless the module is a narrowly scoped integration helper.
- Do not own product rules that should stay stable independent of implementation details.
- Do not import from `src/commands/*`.
- Do not let one adapter become a catch-all "god module" for unrelated systems.

## Dependencies
- Allowed: `src/domain/*` for shared models and normalization rules, plus platform APIs and third-party libraries.
- Avoid depending on `src/app/*` unless there is a very small shared contract and no cleaner alternative.
- App should orchestrate infra; infra should not orchestrate app.

## Placement Guide
- Put code here when the main job is "talk to something outside the pure application."
- If logic is mostly sequencing multiple adapters for one user action, move it to app.
- If logic is a stable business rule or value transformation, move it to domain.

## Repo-Specific Examples
- `git/worktree-repository.ts` should wrap `git worktree` commands and related parsing.
- `storage/settings-store.ts` should load and save settings, but settings defaults belong in domain.
- `shell/installer.ts` should generate wrapper files and source lines, but command messaging belongs in `src/commands/shell.ts`.
- `update/*` may fetch release assets and install binaries, but should not choose CLI wording or exit semantics.
