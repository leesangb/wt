import { describe, expect, test } from "bun:test";
import { DEFAULT_WT_SETTINGS } from "../../domain/settings.js";
import type { WorktreeInfo } from "../../domain/worktree.js";
import {
  createWorktreeRemoval,
  type WorktreeRemovalDependencies,
} from "./remove-worktree.js";

const context = {
  cwd: "/repo",
  repoRoot: "/repo",
  repoName: "project",
};

function createWorktree(): WorktreeInfo {
  return {
    id: "feature-a",
    fullId: "project-feature-a",
    path: "/worktrees/feature-a",
    branch: "feature/a",
    isMain: false,
    repoName: "project",
    createdAt: "2026-07-18T00:00:00.000Z",
    baseBranch: "main",
    baseCommit: "base-commit",
  };
}

function createDependencies(): {
  dependencies: WorktreeRemovalDependencies;
  status: {
    localCommitCount: number;
    localChangeCount: number;
    hasUnknownLocalCommits: boolean;
  };
  removedPaths: string[];
  deletedBranches: string[];
  changedDirectories: string[];
  startedTasks: unknown[];
} {
  const worktree = createWorktree();
  const status = {
    localCommitCount: 0,
    localChangeCount: 0,
    hasUnknownLocalCommits: false,
  };
  const removedPaths: string[] = [];
  const deletedBranches: string[] = [];
  const changedDirectories: string[] = [];
  const startedTasks: unknown[] = [];

  return {
    dependencies: {
      repository: {
        requireContext: async () => context,
        loadWorktrees: async () => [worktree],
        listPaths: async () => [
          { path: "/repo", isMain: true },
          { path: worktree.path, isMain: false },
        ],
        inspectStatus: async () => ({ ...status }),
        inspectStatusEntries: async () => ({ entries: [], totalCount: 0 }),
      },
      settings: {
        load: async () => DEFAULT_WT_SETTINGS,
        ensureTaskArtifactsIgnored: async () => undefined,
      },
      git: {
        remove: async (_repoRoot, worktreePath) => {
          removedPaths.push(worktreePath);
        },
        deleteBranch: async (_repoRoot, branch) => {
          deletedBranches.push(branch);
        },
      },
      tasks: {
        start: (options) => {
          startedTasks.push(options);
          return 42;
        },
      },
      herdr: {
        find: async () => ({ attempted: false }),
        close: async () => ({ attempted: false, closed: false }),
      },
      runtime: {
        changeDirectory: (path) => {
          changedDirectories.push(path);
        },
        now: () => new Date("2026-07-18T00:00:00.000Z"),
        platform: "linux",
      },
    },
    status,
    removedPaths,
    deletedBranches,
    changedDirectories,
    startedTasks,
  };
}

describe("worktree removal", () => {
  test("does not remove a worktree when its approved plan becomes stale", async () => {
    const fixture = createDependencies();
    const removal = createWorktreeRemoval(fixture.dependencies);
    const plan = await removal.inspect("feature-a", context.cwd);

    fixture.status.localChangeCount = 1;

    const result = await removal.execute(plan, {
      execution: "foreground",
    });

    expect(result.status).toBe("plan_stale");
    if (result.status !== "plan_stale") {
      throw new Error("Expected a stale removal plan");
    }
    expect(result.latestPlan?.localChangeCount).toBe(1);
    expect(fixture.removedPaths).toEqual([]);
  });

  test("removes a foreground worktree and its branch", async () => {
    const fixture = createDependencies();
    const removal = createWorktreeRemoval(fixture.dependencies);
    const plan = await removal.inspect("feature-a", context.cwd);

    const result = await removal.execute(plan, {
      execution: "foreground",
    });

    expect(result).toMatchObject({
      status: "removed",
      branchDeleted: true,
      warnings: [],
    });
    expect(fixture.removedPaths).toEqual(["/worktrees/feature-a"]);
    expect(fixture.deletedBranches).toEqual(["feature/a"]);
  });

  test("starts background removal for the current non-main worktree", async () => {
    const fixture = createDependencies();
    fixture.dependencies.repository.requireContext = async () => ({
      ...context,
      cwd: "/worktrees/feature-a/nested",
    });
    const removal = createWorktreeRemoval(fixture.dependencies);
    const plan = await removal.inspect(
      "feature-a",
      "/worktrees/feature-a/nested"
    );

    const result = await removal.execute(plan, { execution: "auto" });

    expect(result).toMatchObject({
      status: "background_started",
      branchDeleteQueued: true,
      relocatedToPath: "/repo",
      pid: 42,
    });
    expect(fixture.startedTasks).toHaveLength(1);
    expect(fixture.removedPaths).toEqual([]);
    expect(fixture.changedDirectories).toEqual([]);
  });

  test("relocates the removal process before foreground removal of the current worktree", async () => {
    const fixture = createDependencies();
    fixture.dependencies.repository.requireContext = async () => ({
      ...context,
      cwd: "/worktrees/feature-a/nested",
    });
    const removal = createWorktreeRemoval(fixture.dependencies);
    const plan = await removal.inspect(
      "feature-a",
      "/worktrees/feature-a/nested"
    );

    const result = await removal.execute(plan, {
      execution: "foreground",
    });

    expect(result).toMatchObject({
      status: "removed",
      relocatedToPath: "/repo",
    });
    expect(fixture.changedDirectories).toEqual(["/repo"]);
    expect(fixture.removedPaths).toEqual(["/worktrees/feature-a"]);
  });

  test("returns partial failure and Herdr warnings after removing the worktree", async () => {
    const fixture = createDependencies();
    fixture.dependencies.git.deleteBranch = async () => {
      throw new Error("branch is checked out elsewhere");
    };
    fixture.dependencies.herdr.find = async () => ({
      attempted: true,
      workspaceId: "workspace-1",
    });
    fixture.dependencies.herdr.close = async () => ({
      attempted: true,
      closed: false,
      error: "Herdr unavailable",
    });
    const removal = createWorktreeRemoval(fixture.dependencies);
    const plan = await removal.inspect("feature-a", context.cwd);

    const result = await removal.execute(plan, {
      execution: "foreground",
    });

    expect(result).toEqual({
      status: "worktree_removed_branch_failed",
      worktree: createWorktree(),
      relocatedToPath: undefined,
      error: "branch is checked out elsewhere",
      warnings: [
        {
          kind: "herdr_close_failed",
          message: "Could not close Herdr workspace: Herdr unavailable",
        },
      ],
    });
    expect(fixture.removedPaths).toEqual(["/worktrees/feature-a"]);
  });
});
