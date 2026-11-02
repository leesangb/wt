import type { $ } from "bun";
import type { WtSettings } from "./domain/settings.js";

export interface PluginContext {
  /** The repository from which wt was invoked. */
  repoRoot: string;
  /** A safe working directory for commands, including during removal. */
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
  settings: Readonly<WtSettings>;
  /** Bun shell with cwd/env set for this operation and output captured by default. */
  $: (...args: Parameters<typeof $>) => ReturnType<typeof $>;
}

export interface WorktreeOpenInput {
  id: string;
  path: string;
  branch: string;
  label: string;
  focus: boolean;
}

export interface WorktreeRemoveInput {
  id: string;
  path: string;
  branch?: string;
}

export type WorktreeRemovalOutcome =
  | { status: "removed"; branchDeleted: boolean }
  | { status: "worktree_removed_branch_failed"; error: string }
  | { status: "background_started"; pid: number };

/** Called only after removal succeeds or a background removal task starts. */
export type AfterWorktreeRemoval = (
  outcome: WorktreeRemovalOutcome
) => void | Promise<void>;

export interface PluginHooks {
  "worktree.open"?: (
    input: WorktreeOpenInput
  ) => "handled" | "skipped" | void | Promise<"handled" | "skipped" | void>;
  "worktree.remove.before"?: (
    input: WorktreeRemoveInput
  ) => AfterWorktreeRemoval | void | Promise<AfterWorktreeRemoval | void>;
}

/** Default-export a plugin factory from a .js/.ts file in a wt plugins directory. */
export type Plugin = (
  context: PluginContext
) => PluginHooks | Promise<PluginHooks>;
