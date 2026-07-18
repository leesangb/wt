import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  openHerdrWorktree,
  syncInstalledWtHerdrPlugin,
} from "./client.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("Herdr client", () => {
  test("does nothing outside a Herdr-managed pane", async () => {
    expect(await openHerdrWorktree("/worktree", "feature", {}, {})).toEqual({
      attempted: false,
      opened: false,
    });
  });

  test("updates a GitHub-managed wt plugin to the matching release tag", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-herdr-sync-"));
    tempDirs.push(dir);
    const fakeHerdr = join(dir, "herdr");
    const logPath = join(dir, "args.log");
    writeFileSync(
      fakeHerdr,
      [
        "#!/bin/sh",
        'if [ "$1 $2" = "plugin list" ]; then',
        `  printf '%s\\n' '{"result":{"plugins":[{"plugin_id":"wt.herdr","source":{"kind":"github","owner":"leesangb","repo":"wt","requested_ref":"v0.8.0"}}]}}'`,
        "  exit 0",
        "fi",
        `printf '%s\\n' "$*" > "${logPath}"`,
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    expect(
      await syncInstalledWtHerdrPlugin("0.9.0", {}, {
        HERDR_BIN_PATH: fakeHerdr,
      })
    ).toEqual({ status: "updated", version: "0.9.0" });
    expect(readFileSync(logPath, "utf-8")).toBe(
      "plugin install leesangb/wt --ref v0.9.0 --yes\n"
    );
  });

  test("does not replace a locally linked wt plugin", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-herdr-sync-"));
    tempDirs.push(dir);
    const fakeHerdr = join(dir, "herdr");
    writeFileSync(
      fakeHerdr,
      [
        "#!/bin/sh",
        `printf '%s\\n' '{"result":{"plugins":[{"plugin_id":"wt.herdr","source":{"kind":"linked"}}]}}'`,
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    expect(
      await syncInstalledWtHerdrPlugin("0.9.0", {}, {
        HERDR_BIN_PATH: fakeHerdr,
      })
    ).toEqual({
      status: "skipped-linked",
      warning: "The wt Herdr plugin is locally linked; leaving it unchanged.",
    });
  });

  test("skips an exact plugin ref unless force is enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wt-herdr-sync-"));
    tempDirs.push(dir);
    const fakeHerdr = join(dir, "herdr");
    const logPath = join(dir, "args.log");
    writeFileSync(
      fakeHerdr,
      [
        "#!/bin/sh",
        'if [ "$1 $2" = "plugin list" ]; then',
        `  printf '%s\\n' '{"result":{"plugins":[{"plugin_id":"wt.herdr","source":{"kind":"github","owner":"leesangb","repo":"wt","requested_ref":"v0.9.0"}}]}}'`,
        "  exit 0",
        "fi",
        `printf '%s\\n' "$*" > "${logPath}"`,
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    expect(
      await syncInstalledWtHerdrPlugin("0.9.0", {}, {
        HERDR_BIN_PATH: fakeHerdr,
      })
    ).toEqual({ status: "up-to-date", version: "0.9.0" });

    expect(
      await syncInstalledWtHerdrPlugin("0.9.0", { force: true }, {
        HERDR_BIN_PATH: fakeHerdr,
      })
    ).toEqual({ status: "updated", version: "0.9.0" });
    expect(readFileSync(logPath, "utf-8")).toBe(
      "plugin install leesangb/wt --ref v0.9.0 --yes\n"
    );
  });
});
