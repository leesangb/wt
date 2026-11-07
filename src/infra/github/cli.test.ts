import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";

test("PR suggestion queries distinguish empty results from failures and stop timed-out children", async () => {
  const root = mkdtempSync(join(tmpdir(), "wt-gh-query-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "gh"), `#!/bin/sh
case "$GH_QUERY_MODE" in
  empty) printf '[]\\n' ;;
  malformed) printf 'invalid-json\\n' ;;
  failed) exit 1 ;;
  slow) exec "$GH_TEST_BUN" -e 'await Bun.sleep(10000)' ;;
esac
`, { mode: 0o755 });
    const modulePath = fileURLToPath(new URL("./cli.ts", import.meta.url));
    const script = join(root, "run.ts");
    writeFileSync(script, `
      import { listOpenPullRequests, queryOpenPullRequests } from ${JSON.stringify(modulePath)};
      const results = [];
      for (const mode of ["empty", "malformed", "failed", "slow"]) {
        process.env.GH_QUERY_MODE = mode;
        const value = await queryOpenPullRequests(${JSON.stringify(root)}, {timeoutMs: mode === "slow" ? 100 : undefined});
        results.push({mode, value: value ?? null});
      }
      process.env.GH_QUERY_MODE = "failed";
      const fallback = await listOpenPullRequests(${JSON.stringify(root)});
      console.log(JSON.stringify({results, fallback}));
    `);
    const child = Bun.spawn([process.execPath, script], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_TEST_BUN: process.execPath },
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
      results: [
        { mode: "empty", value: [] },
        { mode: "malformed", value: null },
        { mode: "failed", value: null },
        { mode: "slow", value: null },
      ],
      fallback: [],
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
