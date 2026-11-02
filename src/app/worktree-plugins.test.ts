import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSettings } from "../domain/settings.js";
import { loadWorktreePlugins } from "./worktree-plugins.js";

describe("worktree plugins", () => {
  test("prefers project plugins over global namesakes and stops opening at the first handler", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-plugins-"));
    try {
      const repoRoot = join(root, "repo");
      const localDir = join(repoRoot, ".wt", "plugins");
      const globalDir = join(root, "config", "wt", "plugins");
      mkdirSync(localDir, { recursive: true });
      mkdirSync(globalDir, { recursive: true });
      writeFileSync(join(localDir, "editor.ts"), `
        export default () => ({
          "worktree.open": ({ path }) => path === "/project" ? "handled" : "skipped",
        });
      `);
      writeFileSync(join(globalDir, "editor.js"), 'throw new Error("Shadowed plugin was imported");');
      writeFileSync(join(globalDir, "fallback.js"), 'export default () => ({ "worktree.open": () => "handled" });');
      writeFileSync(join(globalDir, "later.js"), 'export default () => ({ "worktree.open": () => { throw new Error("Must stop after handling"); } });');

      const plugins = await loadWorktreePlugins({
        repoRoot,
        settings: normalizeSettings({ plugins: { herdr: false, rex: false } }),
        env: { XDG_CONFIG_HOME: join(root, "config") },
      });
      const input = { id: "feature", branch: "feature", label: "Feature", focus: true };

      expect(await plugins.open({ ...input, path: "/project" })).toEqual({ openedBy: "editor", warnings: [] });
      expect(await plugins.open({ ...input, path: "/other" })).toEqual({ openedBy: "fallback", warnings: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("reports invalid modules and hook results without preventing another plugin from opening", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-plugins-"));
    try {
      const pluginDir = join(root, ".wt", "plugins");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "a-export.ts"), 'export default {};');
      writeFileSync(join(pluginDir, "b-hook.ts"), 'export default () => ({ "worktree.opne": () => {} });');
      writeFileSync(join(pluginDir, "c-result.js"), 'export default () => ({ "worktree.open": () => true });');
      writeFileSync(join(pluginDir, "d-editor.js"), 'export default () => ({ "worktree.open": () => "handled" });');

      const plugins = await loadWorktreePlugins({
        repoRoot: root,
        settings: normalizeSettings({ plugins: { herdr: false, rex: false } }),
        env: { XDG_CONFIG_HOME: join(root, "config") },
      });
      const result = await plugins.open({ id: "id", path: root, branch: "feature", label: "Feature", focus: false });

      expect(result.openedBy).toBe("d-editor");
      expect(result.warnings.map(({ plugin }) => plugin)).toEqual(["a-export", "b-hook", "c-result"]);
      expect(result.warnings[1]?.message).toContain("Unknown hook: worktree.opne");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("keeps removal state in each callback and continues after a callback fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "wt-plugins-"));
    try {
      const pluginDir = join(root, ".wt", "plugins");
      const logPath = join(root, "callbacks.jsonl");
      mkdirSync(pluginDir, { recursive: true });
      writeFileSync(join(pluginDir, "a-failure.js"), `
        export default () => ({
          "worktree.remove.before": () => () => { throw new Error("Editor unavailable"); },
        });
      `);
      writeFileSync(join(pluginDir, "b-record.ts"), `
        import { appendFileSync } from "node:fs";
        export default ({ env }) => ({
          "worktree.remove.before": ({ id }: { id: string }) => (outcome) => {
            appendFileSync(env.TRACE, JSON.stringify({ id, ...outcome }) + "\\n");
          },
        });
      `);
      const plugins = await loadWorktreePlugins({
        repoRoot: root,
        settings: normalizeSettings({ plugins: { herdr: false, rex: false } }),
        env: { XDG_CONFIG_HOME: join(root, "config"), TRACE: logPath },
      });
      const finishFirst = await plugins.prepareRemoval({ id: "first", path: "/first" });
      const finishSecond = await plugins.prepareRemoval({ id: "second", path: "/second" });

      const warnings = await finishSecond({ status: "background_started", pid: 42 });
      await finishFirst({ status: "removed", branchDeleted: false });

      expect(warnings).toEqual([{
        plugin: "a-failure",
        message: 'Plugin "a-failure" removal callback failed: Editor unavailable',
      }]);
      const entries = (await Bun.file(logPath).text()).trim().split("\n").map((line) => JSON.parse(line));
      expect(entries).toEqual([
        { id: "second", status: "background_started", pid: 42 },
        { id: "first", status: "removed", branchDeleted: false },
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
