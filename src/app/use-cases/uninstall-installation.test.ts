import { describe, expect, test } from "bun:test";
import { AppError } from "../errors.js";
import {
  resolveCurrentStandaloneBinaryPath,
  uninstallInstallation,
} from "./uninstall-installation.js";

describe("uninstall installation use case", () => {
  test("resolves the current standalone binary path for compiled installs", () => {
    expect(
      resolveCurrentStandaloneBinaryPath({
        argv0: "wt",
        execPath: "/Users/test/.local/bin/wt",
      })
    ).toBe("/Users/test/.local/bin/wt");
  });

  test("does not treat bun-launched source execution as a standalone install", () => {
    expect(
      resolveCurrentStandaloneBinaryPath({
        argv0: "bun",
        execPath: "/Users/test/.bun/bin/bun",
      })
    ).toBeUndefined();
  });

  test("does not treat Homebrew-managed binaries as standalone installs", () => {
    expect(
      resolveCurrentStandaloneBinaryPath({
        argv0: "/opt/homebrew/bin/wt",
        execPath: "/opt/homebrew/bin/wt",
        resolvePath: () => "/opt/homebrew/Cellar/wt/0.4.0/bin/wt",
      })
    ).toBeUndefined();
  });

  test("removes the standalone binary and shell integration", () => {
    const removedBinaryPaths: string[] = [];
    const result = uninstallInstallation({
      processInfo: {
        argv0: "wt",
        execPath: "/Users/test/.local/bin/wt",
      },
      removeBinary: (binaryPath) => {
        removedBinaryPaths.push(binaryPath);
      },
      removeShellIntegration: () => ({
        shellDir: "/Users/test/.wt/shell",
        shellDirRemoved: true,
        updatedShellConfigs: [{ path: "/Users/test/.zshrc", shell: "zsh" }],
        warnings: [],
      }),
    });

    expect(result).toEqual({
      strategy: "standalone",
      binaryPath: "/Users/test/.local/bin/wt",
      shellIntegration: {
        shellDir: "/Users/test/.wt/shell",
        shellDirRemoved: true,
        updatedShellConfigs: [{ path: "/Users/test/.zshrc", shell: "zsh" }],
        warnings: [],
      },
    });
    expect(removedBinaryPaths).toEqual(["/Users/test/.local/bin/wt"]);
  });

  test("delegates Homebrew installs through the app layer", () => {
    const delegatedCommands: string[] = [];
    const executedPlans: Array<{ args: string[]; displayCommand: string }> = [];

    const result = uninstallInstallation({
      processInfo: {
        argv0: "bun",
        execPath: "/Users/test/.bun/bin/bun",
      },
      isHomebrewInstallAvailable: () => true,
      onBeforeHomebrewUninstall: (command) => delegatedCommands.push(command),
      runHomebrewUninstall: (plan) => {
        executedPlans.push(plan);
      },
      removeShellIntegration: () => ({
        shellDir: "/Users/test/.wt/shell",
        shellDirRemoved: false,
        updatedShellConfigs: [],
        warnings: [],
      }),
    });

    expect(result).toEqual({
      strategy: "homebrew",
      delegatedCommand: "brew uninstall wt",
      shellIntegration: {
        shellDir: "/Users/test/.wt/shell",
        shellDirRemoved: false,
        updatedShellConfigs: [],
        warnings: [],
      },
    });
    expect(delegatedCommands).toEqual(["brew uninstall wt"]);
    expect(executedPlans).toEqual([
      {
        args: ["uninstall", "wt"],
        displayCommand: "brew uninstall wt",
      },
    ]);
  });

  test("prefers the current Homebrew-managed install over a discovered standalone path", () => {
    const removedBinaryPaths: string[] = [];
    const executedPlans: Array<{ args: string[]; displayCommand: string }> = [];

    const result = uninstallInstallation({
      processInfo: {
        argv0: "/opt/homebrew/bin/wt",
        execPath: "/opt/homebrew/bin/wt",
        resolvePath: () => "/opt/homebrew/Cellar/wt/0.4.0/bin/wt",
      },
      standaloneBinaryPath: "/Users/test/.local/bin/wt",
      removeBinary: (binaryPath) => removedBinaryPaths.push(binaryPath),
      runHomebrewUninstall: (plan) => {
        executedPlans.push(plan);
      },
      removeShellIntegration: () => ({
        shellDir: "/Users/test/.wt/shell",
        shellDirRemoved: false,
        updatedShellConfigs: [],
        warnings: [],
      }),
    });

    expect(result.strategy).toBe("homebrew");
    expect(removedBinaryPaths).toEqual([]);
    expect(executedPlans).toEqual([
      {
        args: ["uninstall", "wt"],
        displayCommand: "brew uninstall wt",
      },
    ]);
  });

  test("fails with an actionable error when no installation is found", () => {
    expect(() =>
      uninstallInstallation({
        processInfo: {
          argv0: "bun",
          execPath: "/Users/test/.bun/bin/bun",
        },
        isHomebrewInstallAvailable: () => false,
      })
    ).toThrow(
      new AppError(
        "Could not find an installed wt binary to uninstall. If you are running from a source checkout, use `./uninstall.sh` or remove the installed binary manually."
      )
    );
  });
});
