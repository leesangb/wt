import { describe, expect, test } from "bun:test";
import { AppError } from "../../app/errors.js";
import {
  buildHomebrewUpdatePlan,
  isHomebrewManagedInstallation,
  runHomebrewUpdate,
} from "./homebrew.js";

describe("homebrew update support", () => {
  test("detects Homebrew installs from the stable bin path", () => {
    expect(
      isHomebrewManagedInstallation({
        argv0: "wt",
        execPath: "/opt/homebrew/bin/wt",
        resolvePath: () => "/opt/homebrew/Cellar/wt/0.3.0/bin/wt",
      })
    ).toBeTrue();
  });

  test("detects Homebrew installs from a Cellar path", () => {
    expect(
      isHomebrewManagedInstallation({
        argv0: "/opt/homebrew/bin/wt",
        execPath: "/opt/homebrew/Cellar/wt/0.3.0/bin/wt",
        resolvePath: () => "/opt/homebrew/Cellar/wt/0.3.0/bin/wt",
      })
    ).toBeTrue();
  });

  test("does not detect standalone installs as Homebrew-managed", () => {
    expect(
      isHomebrewManagedInstallation({
        argv0: "/Users/test/.local/bin/wt",
        execPath: "/Users/test/.local/bin/wt",
      })
    ).toBeFalse();
  });

  test("does not classify a plain /usr/local/bin install as Homebrew-managed", () => {
    expect(
      isHomebrewManagedInstallation({
        argv0: "/usr/local/bin/wt",
        execPath: "/usr/local/bin/wt",
        resolvePath: () => "/usr/local/bin/wt",
      })
    ).toBeFalse();
  });

  test("uses brew upgrade by default", () => {
    expect(buildHomebrewUpdatePlan({})).toEqual({
      args: ["upgrade", "wt"],
      displayCommand: "brew upgrade wt",
    });
  });

  test("uses brew reinstall when force is requested", () => {
    expect(buildHomebrewUpdatePlan({ force: true })).toEqual({
      args: ["reinstall", "wt"],
      displayCommand: "brew reinstall wt",
    });
  });

  test("rejects version pinning for Homebrew installs", () => {
    expect(() => buildHomebrewUpdatePlan({ version: "0.3.0" })).toThrow(
      new AppError(
        "Homebrew-managed installs do not support `wt update --version`. Use Homebrew to install a specific formula revision instead."
      )
    );
  });

  test("rejects quarantine toggles for Homebrew installs", () => {
    expect(() =>
      buildHomebrewUpdatePlan({ removeQuarantine: false })
    ).toThrow(
      new AppError(
        "`--no-remove-quarantine` is only supported for standalone binary installs."
      )
    );
  });

  test("runs the generated brew command", () => {
    const calls: Array<{
      command: string;
      args: string[];
      stdio: string;
    }> = [];

    runHomebrewUpdate(
      {
        args: ["upgrade", "wt"],
        displayCommand: "brew upgrade wt",
      },
      (command, args, options) => {
        calls.push({
          command,
          args,
          stdio: options.stdio,
        });

        return {
          status: 0,
          signal: null,
        };
      }
    );

    expect(calls).toEqual([
      {
        command: "brew",
        args: ["upgrade", "wt"],
        stdio: "inherit",
      },
    ]);
  });

  test("surfaces brew failures with a manual fallback hint", () => {
    expect(() =>
      runHomebrewUpdate(
        {
          args: ["upgrade", "wt"],
          displayCommand: "brew upgrade wt",
        },
        () => ({
          status: 1,
          signal: null,
        })
      )
    ).toThrow(
      new AppError(
        "brew upgrade wt failed. Try running `brew update && brew upgrade wt` manually."
      )
    );
  });
});
