import { $ } from "bun";
import type { WtSettings } from "../domain/settings.js";
import type {
  AfterWorktreeRemoval,
  PluginContext,
  WorktreeOpenInput,
  WorktreeRemoveInput,
  WorktreeRemovalOutcome,
} from "../plugin.js";
import {
  loadPluginHooks,
  pluginWarning,
  type PluginWarning,
} from "../infra/plugins/loader.js";
import { buildScriptEnv } from "../infra/scripts/runner.js";
import herdr from "../plugins/herdr.js";

export type { PluginWarning } from "../infra/plugins/loader.js";

export async function loadWorktreePlugins(options: {
  repoRoot: string;
  settings: WtSettings;
  cwd?: string;
  env?: Record<string, string | undefined>;
}) {
  const { repoRoot, settings, cwd = repoRoot } = options;
  const env = buildScriptEnv(options.env);
  const context: PluginContext = {
    repoRoot,
    cwd,
    settings,
    env,
    $: (...args) => $(...args).cwd(cwd).env(env).quiet(),
  };
  const loaded = await loadPluginHooks(context, { herdr });

  return {
    async open(input: WorktreeOpenInput) {
      const warnings = [...loaded.warnings];
      for (const { name, hooks } of loaded.plugins) {
        if (!hooks["worktree.open"]) continue;
        try {
          const result = await hooks["worktree.open"](input);
          if (result === "handled") return { openedBy: name, warnings };
          if (result !== undefined && result !== "skipped") {
            throw new Error('Return "handled", "skipped", or nothing');
          }
        } catch (error) {
          warnings.push(pluginWarning(name, "worktree.open failed", error));
        }
      }
      return { openedBy: undefined, warnings };
    },

    async prepareRemoval(input: WorktreeRemoveInput) {
      const warnings = [...loaded.warnings];
      const callbacks: Array<{ name: string; callback: AfterWorktreeRemoval }> = [];
      for (const { name, hooks } of loaded.plugins) {
        if (!hooks["worktree.remove.before"]) continue;
        try {
          const callback = await hooks["worktree.remove.before"](input);
          if (callback !== undefined && typeof callback !== "function") {
            throw new Error("Return a removal callback or nothing");
          }
          if (callback) callbacks.push({ name, callback });
        } catch (error) {
          warnings.push(pluginWarning(name, "worktree.remove.before failed", error));
        }
      }

      return async (outcome: WorktreeRemovalOutcome): Promise<PluginWarning[]> => {
        const resultWarnings = [...warnings];
        for (const { name, callback } of callbacks) {
          try {
            await callback(outcome);
          } catch (error) {
            resultWarnings.push(pluginWarning(name, "removal callback failed", error));
          }
        }
        return resultWarnings;
      };
    },
  };
}
