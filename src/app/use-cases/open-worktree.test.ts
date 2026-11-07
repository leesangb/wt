import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

test("opening reuses the supplied repository root and reloads settings after creation", async () => {
  const root = mkdtempSync(join(tmpdir(), "wt-open-context-"));
  try {
    const pluginDir = join(root, ".wt", "plugins");
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, "editor.ts"), `
      export default () => ({ "worktree.open": () => "handled" });
    `);
    const modulePath = fileURLToPath(new URL("./open-worktree.ts", import.meta.url));
    const script = join(root, "run.ts");
    writeFileSync(script, `
      import { openCreatedWorktree } from ${JSON.stringify(modulePath)};
      const worktree = { id: "feature", branchName: "feature", worktreePath: ${JSON.stringify(root)}, repoRoot: ${JSON.stringify(root)} };
      const settingsPath = ${JSON.stringify(join(root, ".wt", "settings.json"))};
      await Bun.write(settingsPath, JSON.stringify({ plugins: { editor: false, herdr: false, rex: false } }));
      const first = await openCreatedWorktree(worktree, {}, ${JSON.stringify(root)});
      await Bun.write(settingsPath, JSON.stringify({ plugins: { editor: true, herdr: false, rex: false } }));
      const second = await openCreatedWorktree(worktree, {}, ${JSON.stringify(root)});
      console.log(JSON.stringify({first, second}));
    `);
    // This directory deliberately has no Git repository: opening must use the
    // root already validated by creation, rather than querying Git again.
    const child = Bun.spawn([process.execPath, script], {
      env: { ...process.env, XDG_CONFIG_HOME: join(root, "config") },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    expect(JSON.parse(stdout)).toEqual({
      first: { warnings: [] },
      second: { openedBy: "editor", warnings: [] },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
