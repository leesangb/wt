import { describe, expect, test } from "bun:test";
import {
  getUpdateStrategy,
  updateInstallation,
} from "./update-installation.js";

describe("update installation use case", () => {
  test("reports Homebrew strategy when the executable resolves into Cellar", () => {
    expect(
      getUpdateStrategy({
        execPath: "/opt/homebrew/bin/wt",
        resolvePath: () => "/opt/homebrew/Cellar/wt/0.3.0/bin/wt",
      })
    ).toBe("homebrew");
  });

  test("delegates Homebrew installs through the app layer", async () => {
    const delegatedCommands: string[] = [];
    const executedPlans: Array<{ args: string[]; displayCommand: string }> = [];
    const refreshedBinaries: string[] = [];
    const versionedBinaries: string[] = [];
    const syncedVersions: string[] = [];

    const result = await updateInstallation("0.3.0", {}, {
      processInfo: {
        execPath: "/opt/homebrew/bin/wt",
        resolvePath: () => "/opt/homebrew/Cellar/wt/0.3.0/bin/wt",
      },
      onBeforeHomebrewUpdate: (command) => delegatedCommands.push(command),
      runHomebrewUpdate: (plan) => executedPlans.push(plan),
      readInstalledVersion: (binaryPath) => {
        versionedBinaries.push(binaryPath);
        return "0.4.0";
      },
      refreshShellWrappers: (binaryPath) => {
        refreshedBinaries.push(binaryPath);
        return {
          refreshedShells: ["zsh"],
          warnings: [],
        };
      },
      syncHerdrPlugin: async (version) => {
        syncedVersions.push(version);
        return { status: "updated", version };
      },
    });

    expect(result).toEqual({
      strategy: "homebrew",
      delegatedCommand: "brew upgrade wt",
      shellIntegration: {
        refreshedShells: ["zsh"],
        warnings: [],
      },
      herdrPlugin: { status: "updated", version: "0.4.0" },
    });
    expect(delegatedCommands).toEqual(["brew upgrade wt"]);
    expect(executedPlans).toEqual([
      {
        args: ["upgrade", "wt"],
        displayCommand: "brew upgrade wt",
      },
    ]);
    expect(refreshedBinaries).toEqual(["/opt/homebrew/bin/wt"]);
    expect(versionedBinaries).toEqual(["/opt/homebrew/bin/wt"]);
    expect(syncedVersions).toEqual(["0.4.0"]);
  });

  test("refreshes existing shell wrappers after a standalone binary update", async () => {
    const downloads: string[] = [];
    const replacements: Array<{ tempPath: string; execPath: string }> = [];
    const quarantines: string[] = [];
    const refreshedBinaries: string[] = [];
    const syncedHerdrPlugins: Array<{ version: string; force: boolean }> = [];

    const result = await updateInstallation(
      "0.6.0",
      { version: "0.6.1" },
      {
        arch: "arm64",
        platform: "darwin",
        processInfo: {
          argv0: "wt",
          execPath: "/Users/test/.local/bin/wt",
        },
        downloadBinary: async (url) => {
          downloads.push(url);
          return "/tmp/wt-new";
        },
        replaceCurrentBinary: (tempPath, execPath) => {
          replacements.push({ tempPath, execPath });
        },
        removeMacosQuarantine: async (execPath) => {
          quarantines.push(execPath);
        },
        refreshShellWrappers: (binaryPath) => {
          refreshedBinaries.push(binaryPath);
          return {
            refreshedShells: ["bash", "zsh"],
            warnings: [],
          };
        },
        syncHerdrPlugin: async (version, { force }) => {
          syncedHerdrPlugins.push({ version, force });
          return { status: "updated", version };
        },
      }
    );

    expect(downloads).toEqual([
      "https://github.com/leesangb/wt/releases/download/v0.6.1/wt-macos-arm64",
    ]);
    expect(replacements).toEqual([
      {
        tempPath: "/tmp/wt-new",
        execPath: "/Users/test/.local/bin/wt",
      },
    ]);
    expect(quarantines).toEqual(["/Users/test/.local/bin/wt"]);
    expect(refreshedBinaries).toEqual(["/Users/test/.local/bin/wt"]);
    expect(syncedHerdrPlugins).toEqual([{ version: "0.6.1", force: false }]);
    expect(result).toEqual({
      strategy: "standalone",
      currentVersion: "0.6.0",
      targetVersion: "0.6.1",
      updated: true,
      assetName: "wt-macos-arm64",
      shellIntegration: {
        refreshedShells: ["bash", "zsh"],
        warnings: [],
      },
      herdrPlugin: {
        status: "updated",
        version: "0.6.1",
      },
    });
  });

  test("syncs the Herdr plugin when the standalone binary is already current", async () => {
    const syncedVersions: string[] = [];

    const result = await updateInstallation(
      "0.6.1",
      { version: "0.6.1" },
      {
        arch: "arm64",
        platform: "darwin",
        processInfo: {
          argv0: "wt",
          execPath: "/Users/test/.local/bin/wt",
        },
        syncHerdrPlugin: async (version) => {
          syncedVersions.push(version);
          return { status: "up-to-date", version };
        },
      }
    );

    expect(syncedVersions).toEqual(["0.6.1"]);
    expect(result).toMatchObject({
      strategy: "standalone",
      updated: false,
      herdrPlugin: { status: "up-to-date", version: "0.6.1" },
    });
  });
});
