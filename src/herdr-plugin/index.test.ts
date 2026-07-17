import { describe, expect, test } from "bun:test";
import {
  decodeLaunchContext,
  buildBaseBranchChoices,
  buildPullRequestChoices,
  buildPullRequestHeader,
  encodeLaunchContext,
  parsePluginContext,
  parseWtJsonOutput,
} from "./index.js";

describe("wt Herdr plugin", () => {
  test("prefers local base branches and keeps remote-only refs usable", () => {
    expect(
      buildBaseBranchChoices(
        "main\nfeature/local\norigin/HEAD\norigin/main\norigin/release/1.0\n"
      )
    ).toEqual([
      { name: "feature/local", ref: "feature/local", local: true },
      { name: "main", ref: "main", local: true },
      { name: "release/1.0", ref: "origin/release/1.0", local: false },
    ]);
  });

  test("formats pull requests with searchable metadata and a hidden number", () => {
    const [choice] = buildPullRequestChoices(
        JSON.stringify([
          {
            number: 142,
            title: "Fix\tlogin failure",
            author: { login: "sangbin" },
            headRefName: "feature/login-fix",
            isDraft: true,
          },
        ]),
        100
      );
    const display = choice!.split("\t")[0]!;
    const plainDisplay = display.replaceAll(/\x1b\[[0-9;]*m/g, "");

    expect(choice!.endsWith("\t142")).toBeTrue();
    expect(display).toContain("\x1b[90mDraft");
    expect(Bun.stringWidth(plainDisplay)).toBe(100);
    expect(plainDisplay).toContain("Fix login failure");
    expect(plainDisplay).toContain("@sangbin");
    expect(plainDisplay).toContain("feature/login-fix");
    expect(buildPullRequestHeader(100)).toStartWith("PR        Status");
  });

  test("keeps the origin workspace and focused pane cwd", () => {
    const context = parsePluginContext(
      JSON.stringify({
        workspace_id: "w3",
        workspace_cwd: "/repo",
        focused_pane_cwd: "/repo/packages/app",
      }),
      "new"
    );

    expect(decodeLaunchContext(encodeLaunchContext(context))).toEqual({
      mode: "new",
      workspaceId: "w3",
      cwd: "/repo/packages/app",
    });
  });

  test("falls back to the workspace cwd", () => {
    expect(
      parsePluginContext(
        JSON.stringify({ workspace_id: "w1", workspace_cwd: "/repo" }),
        "checkout"
      )
    ).toEqual({ mode: "checkout", workspaceId: "w1", cwd: "/repo" });
  });

  test("reads the final structured wt result after git progress output", () => {
    expect(
      parseWtJsonOutput(
        'HEAD is now at abc base\n{"id":"feature-a","path":"/tmp/repo-feature-a","branch":"feature/a"}\n'
      )
    ).toEqual({
      id: "feature-a",
      path: "/tmp/repo-feature-a",
      branch: "feature/a",
    });
  });
});
