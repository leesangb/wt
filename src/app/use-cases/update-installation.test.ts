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

    const result = await updateInstallation("0.3.0", {}, {
      processInfo: {
        execPath: "/opt/homebrew/bin/wt",
        resolvePath: () => "/opt/homebrew/Cellar/wt/0.3.0/bin/wt",
      },
      onBeforeHomebrewUpdate: (command) => delegatedCommands.push(command),
      runHomebrewUpdate: (plan) => executedPlans.push(plan),
    });

    expect(result).toEqual({
      strategy: "homebrew",
      delegatedCommand: "brew upgrade wt",
    });
    expect(delegatedCommands).toEqual(["brew upgrade wt"]);
    expect(executedPlans).toEqual([
      {
        args: ["upgrade", "wt"],
        displayCommand: "brew upgrade wt",
      },
    ]);
  });
});
