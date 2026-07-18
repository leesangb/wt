import { describe, expect, test } from "bun:test";
import {
  decodeLaunchContext,
  buildBaseBranchChoices,
  buildPullRequestChoices,
  buildPullRequestHeader,
  ciStatusToken,
  closedLinkedWorktrees,
  encodeLaunchContext,
  parsePullRequestDetails,
  parseWorkspaceFocusedEvent,
  parseWorktreeOpenedEvent,
  parsePluginContext,
  parseWtJsonOutput,
  pullRequestStatusToken,
  streamAndCaptureOutput,
} from "./index.js";

describe("wt Herdr plugin", () => {
  test("selects only closed, healthy linked worktrees for bulk opening", () => {
    expect(
      closedLinkedWorktrees(
        JSON.stringify({
          result: {
            source: { source_workspace_id: "w1" },
            worktrees: [
              {
                is_linked_worktree: false,
                is_prunable: false,
                label: "repo",
                open_workspace_id: "w1",
                path: "/repo",
              },
              {
                is_linked_worktree: true,
                is_prunable: false,
                label: "feature-a",
                path: "/worktrees/feature-a",
              },
              {
                is_linked_worktree: true,
                is_prunable: false,
                label: "feature-b",
                open_workspace_id: "w2",
                path: "/worktrees/feature-b",
              },
              {
                is_linked_worktree: true,
                is_prunable: true,
                label: "stale",
                path: "/worktrees/stale",
              },
            ],
          },
        })
      )
    ).toEqual([{ label: "feature-a", path: "/worktrees/feature-a" }]);
  });

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

  test("forwards wt output before the command finishes while retaining it for parsing", async () => {
    const encoder = new TextEncoder();
    let finishStream = () => {};
    let markFirstWrite = () => {};
    const firstWrite = new Promise<void>((resolve) => {
      markFirstWrite = resolve;
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("Creating worktree...\n"));
        finishStream = () => {
          controller.enqueue(
            encoder.encode(
              '{"id":"feature-a","path":"/tmp/feature-a","branch":"feature/a"}\n'
            )
          );
          controller.close();
        };
      },
    });
    const forwarded: string[] = [];

    const capturedOutput = streamAndCaptureOutput(stream, {
      write(chunk) {
        forwarded.push(new TextDecoder().decode(chunk));
        markFirstWrite();
        return true;
      },
    });

    await firstWrite;
    expect(forwarded).toEqual(["Creating worktree...\n"]);

    finishStream();
    expect(await capturedOutput).toBe(
      'Creating worktree...\n{"id":"feature-a","path":"/tmp/feature-a","branch":"feature/a"}\n'
    );
  });

  test("maps GitHub pull request states to compact colored indicators", () => {
    expect(
      pullRequestStatusToken(
        parsePullRequestDetails(
          '{"number":123,"url":"https://github.com/acme/app/pull/123","state":"OPEN","isDraft":false}'
        )
      )
    ).toBe("🟢 #123");
    expect(
      pullRequestStatusToken(
        parsePullRequestDetails(
          '{"number":123,"url":"https://github.com/acme/app/pull/123","state":"OPEN","isDraft":true}'
        )
      )
    ).toBe("⚪ #123");
    expect(
      pullRequestStatusToken(
        parsePullRequestDetails(
          '{"number":123,"url":"https://github.com/acme/app/pull/123","state":"MERGED","isDraft":false}'
        )
      )
    ).toBe("🟣 #123");
    expect(
      pullRequestStatusToken(
        parsePullRequestDetails(
          '{"number":123,"url":"https://github.com/acme/app/pull/123","state":"CLOSED","isDraft":false}'
        )
      )
    ).toBe("🔴 #123");
  });

  test("reduces check buckets to one CI status symbol", () => {
    expect(ciStatusToken('[{"bucket":"pass"},{"bucket":"skipping"}]')).toBe("✅");
    expect(ciStatusToken('[{"bucket":"pass"},{"bucket":"pending"}]')).toBe("🟡");
    expect(ciStatusToken('[{"bucket":"pass"},{"bucket":"fail"}]')).toBe("❌");
    expect(ciStatusToken('[{"bucket":"cancel"}]')).toBe("❌");
    expect(ciStatusToken("[]")).toBeUndefined();
  });

  test("extracts the opened workspace and checkout from a Herdr event", () => {
    expect(
      parseWorktreeOpenedEvent(
        JSON.stringify({
          type: "worktree_opened",
          workspace: {
            workspace_id: "w3",
            worktree: { checkout_path: "/worktrees/pr-123" },
          },
          worktree: { path: "/worktrees/pr-123" },
        })
      )
    ).toEqual({ workspaceId: "w3", cwd: "/worktrees/pr-123" });
  });

  test("extracts a workspace id from a focused event envelope", () => {
    expect(
      parseWorkspaceFocusedEvent(
        JSON.stringify({ event: { type: "workspace_focused", workspace_id: "w7" } })
      )
    ).toBe("w7");
  });
});
