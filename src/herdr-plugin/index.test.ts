import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  decodeLaunchContext,
  buildBaseBranchChoices,
  buildPullRequestChoices,
  buildPullRequestHeader,
  ciStatusToken,
  closedLinkedWorktrees,
  buildWorktreeCreateArgs,
  encodeLaunchContext,
  encodeCreateRequest,
  decodeCreateRequest,
  gitDiffRefreshIntervalMs,
  gitDiffStatusToken,
  parsePullRequestDetails,
  parseWorkspaceFocusedEvent,
  parseWorktreeOpenedEvent,
  parsePluginContext,
  parseWtJsonOutput,
  pullRequestRefreshIntervalMs,
  pullRequestStatusToken,
  refreshMetadataTtlMs,
  resolveBaseBranchSelection,
  streamAndCaptureOutput,
  startBackgroundCreate,
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

  test("accepts an exact existing base branch ref when fzf has no match", () => {
    const refs =
      "main\nfeature/local\norigin/HEAD\norigin/main\norigin/release/1.0\n";

    expect(resolveBaseBranchSelection(refs, "origin/main\n", 1)).toBe(
      "origin/main"
    );
    expect(
      resolveBaseBranchSelection(refs, "origin/release/1.0\n", 1)
    ).toBe("origin/release/1.0");
    expect(
      resolveBaseBranchSelection(refs, "origin/missing\n", 1)
    ).toBeUndefined();
    expect(
      resolveBaseBranchSelection(
        refs,
        "release/1.0\nrelease/1.0\torigin/release/1.0\n",
        0
      )
    ).toBe("origin/release/1.0");
    expect(
      resolveBaseBranchSelection(refs, "origin/main\n", 130)
    ).toBeUndefined();
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

  test("serializes the selected worktree creation request for the background process", () => {
    const request = {
      mode: "new" as const,
      workspaceId: "w3",
      cwd: "/repo/packages/app",
      target: "feature/background-create",
      base: "origin/main",
    };

    expect(decodeCreateRequest(encodeCreateRequest(request))).toEqual(request);
  });

  test("keeps mode-specific wt arguments when creation runs in the background", () => {
    expect(
      buildWorktreeCreateArgs(
        {
          mode: "new",
          workspaceId: "w1",
          cwd: "/repo",
          target: "feature/new",
          base: "main",
        },
        "/plugin/.herdr-plugin/bin/wt"
      )
    ).toEqual([
      "/plugin/.herdr-plugin/bin/wt",
      "new",
      "feature/new",
      "--base",
      "main",
      "--json",
    ]);
    expect(
      buildWorktreeCreateArgs(
        {
          mode: "pr",
          workspaceId: "w1",
          cwd: "/repo",
          target: "142",
        },
        "/plugin/.herdr-plugin/bin/wt"
      )
    ).toEqual([
      "/plugin/.herdr-plugin/bin/wt",
      "pr",
      "142",
      "--json",
    ]);
    expect(
      buildWorktreeCreateArgs(
        {
          mode: "checkout",
          workspaceId: "w1",
          cwd: "/repo",
          target: "feature/existing",
        },
        "/plugin/.herdr-plugin/bin/wt"
      )
    ).toEqual([
      "/plugin/.herdr-plugin/bin/wt",
      "checkout",
      "feature/existing",
      "--json",
    ]);
  });

  test("returns after the detached child starts while the child continues independently", async () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), "wt-herdr-background-"));
    const binDir = join(pluginRoot, ".herdr-plugin", "bin");
    const startPath = join(pluginRoot, "started");
    const releasePath = join(pluginRoot, "release");
    const donePath = join(pluginRoot, "done");
    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      join(binDir, "wt-herdr"),
      [
        "#!/bin/sh",
        'printf started > "$WT_HERDR_TEST_START"',
        'while [ ! -f "$WT_HERDR_TEST_RELEASE" ]; do sleep 0.01; done',
        'printf done > "$WT_HERDR_TEST_DONE"',
        "",
      ].join("\n"),
      { mode: 0o755 }
    );

    try {
      await startBackgroundCreate(
        {
          mode: "checkout",
          workspaceId: "w1",
          cwd: pluginRoot,
          target: "feature/background",
        },
        {
          pluginRoot,
          env: {
            WT_HERDR_TEST_START: startPath,
            WT_HERDR_TEST_RELEASE: releasePath,
            WT_HERDR_TEST_DONE: donePath,
          },
        }
      );

      for (let attempt = 0; attempt < 100 && !existsSync(startPath); attempt++) {
        await Bun.sleep(10);
      }
      expect(existsSync(startPath)).toBeTrue();
      expect(existsSync(donePath)).toBeFalse();

      writeFileSync(releasePath, "release\n");
      for (let attempt = 0; attempt < 100 && !existsSync(donePath); attempt++) {
        await Bun.sleep(10);
      }
      expect(existsSync(donePath)).toBeTrue();
    } finally {
      if (!existsSync(releasePath)) writeFileSync(releasePath, "release\n");
      for (let attempt = 0; attempt < 100 && !existsSync(donePath); attempt++) {
        await Bun.sleep(10);
      }
      rmSync(pluginRoot, { recursive: true, force: true });
    }
  });

  test("surfaces a detached launch error before returning from the handoff", async () => {
    const pluginRoot = mkdtempSync(join(tmpdir(), "wt-herdr-missing-"));

    try {
      await expect(
        startBackgroundCreate(
          {
            mode: "checkout",
            workspaceId: "w1",
            cwd: pluginRoot,
            target: "feature/missing",
          },
          { pluginRoot }
        )
      ).rejects.toThrow();
    } finally {
      rmSync(pluginRoot, { recursive: true, force: true });
    }
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

  test("formats tracked line changes and untracked files for Space metadata", () => {
    expect(
      gitDiffStatusToken(
        "4\t1\tsrc/a.ts\n2\t3\tsrc/b.ts\n-\t-\tpublic/image.png\n",
        "notes.txt\0docs/draft.md\0"
      )
    ).toBe("+6 -4 ?2");
    expect(gitDiffStatusToken("", "")).toBeUndefined();
  });

  test("refreshes focused Spaces more often than background Spaces", () => {
    expect(gitDiffRefreshIntervalMs(true)).toBe(30_000);
    expect(gitDiffRefreshIntervalMs(false)).toBe(300_000);
  });

  test("uses configured intervals for focused and background Spaces", () => {
    const refresh = {
      focusedSeconds: 12,
      backgroundSeconds: 90,
      pullRequestSeconds: 120,
    };

    expect(gitDiffRefreshIntervalMs(true, refresh)).toBe(12_000);
    expect(gitDiffRefreshIntervalMs(false, refresh)).toBe(90_000);
  });

  test("uses the configured pull request safety refresh interval", () => {
    expect(
      pullRequestRefreshIntervalMs({
        focusedSeconds: 12,
        backgroundSeconds: 90,
        pullRequestSeconds: 120,
      })
    ).toBe(120_000);
  });

  test("keeps metadata alive for two configured refresh periods", () => {
    expect(refreshMetadataTtlMs(120_000)).toBe(240_000);
  });

  test("extracts the opened workspace and checkout from a Herdr event", () => {
    expect(
      parseWorktreeOpenedEvent(
        JSON.stringify({
          event: "worktree_opened",
          data: {
            type: "worktree_opened",
            workspace: {
              workspace_id: "w3",
              worktree: { checkout_path: "/worktrees/pr-123" },
            },
            worktree: { path: "/worktrees/pr-123" },
            already_open: false,
          },
        })
      )
    ).toEqual({ workspaceId: "w3", cwd: "/worktrees/pr-123" });
  });

  test("extracts a workspace id from a focused event envelope", () => {
    expect(
      parseWorkspaceFocusedEvent(
        JSON.stringify({
          event: "workspace_focused",
          data: { type: "workspace_focused", workspace_id: "w7" },
        })
      )
    ).toBe("w7");
  });
});
