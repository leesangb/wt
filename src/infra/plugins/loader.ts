import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin, PluginContext, PluginHooks } from "../../plugin.js";
import { getUserConfigDir } from "../storage/settings-store.js";

export interface PluginWarning {
  plugin: string;
  message: string;
}

export function pluginWarning(plugin: string, phase: string, error: unknown): PluginWarning {
  const detail = error instanceof Error ? error.message : String(error);
  return { plugin, message: `Plugin "${plugin}" ${phase}: ${detail}` };
}

function parseHooks(value: unknown): PluginHooks {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The plugin factory must return a hooks object");
  }
  for (const [name, hook] of Object.entries(value)) {
    if (name !== "worktree.open" && name !== "worktree.remove.before") {
      throw new Error(`Unknown hook: ${name}`);
    }
    if (hook !== undefined && typeof hook !== "function") {
      throw new Error(`${name} must be a function`);
    }
  }
  // All hook names and callable values were checked; their results are checked at invocation.
  return value as PluginHooks;
}

export async function loadPluginHooks(
  context: PluginContext,
  builtins: Readonly<Record<string, Plugin>>
) {
  const warnings: PluginWarning[] = [];
  const plugins: Array<{ name: string; hooks: PluginHooks }> = [];
  const seen = new Set<string>();
  // Project plugins override global plugins with the same id. Builtins run last.
  const directories = [
    join(context.repoRoot, ".wt", "plugins"),
    join(getUserConfigDir(context.env), "plugins"),
  ];

  for (const directory of directories) {
    let files: string[];
    try {
      files = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && /\.(?:[cm]?[jt]s)$/.test(entry.name) && !entry.name.endsWith(".d.ts"))
        .map((entry) => entry.name)
        .sort();
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") continue;
      warnings.push(pluginWarning(directory, "discovery failed", error));
      continue;
    }

    for (const file of files) {
      const name = basename(file, extname(file));
      if (seen.has(name)) continue;
      seen.add(name);
      if (context.settings.plugins[name] === false) continue;

      try {
        const module: unknown = await import(pathToFileURL(join(directory, file)).href);
        if (!module || typeof module !== "object" || !("default" in module) || typeof module.default !== "function") {
          throw new Error("Default-export a plugin factory function");
        }
        const hooks = parseHooks(await module.default(context));
        plugins.push({ name, hooks });
      } catch (error) {
        warnings.push(pluginWarning(name, "loading failed", error));
      }
    }
  }

  for (const [name, factory] of Object.entries(builtins)) {
    if (seen.has(name) || context.settings.plugins[name] === false) continue;
    try {
      plugins.push({ name, hooks: await factory(context) });
    } catch (error) {
      warnings.push(pluginWarning(name, "loading failed", error));
    }
  }

  return { plugins, warnings };
}
