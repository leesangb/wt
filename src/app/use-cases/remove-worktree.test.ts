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
  statusEntryInspectionLimits: Array<number | undefined>;
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
  const statusEntryInspectionLimits: Array<number | undefined> = [];

  return {
    dependencies: {
      repository: {
        requireContext: async () => context,
        loadWorktrees: async () => [worktree],
        listPaths: async () => [
          { path: "/repo", isMain: true },
          { path: worktree.path, isMain: false },
        ],
        inspectStatus: async (_repoRoot, _worktreePath, _branch, _base, options) => {
          if (options?.includeStatusEntries) {
            statusEntryInspectionLimits.push(options.statusEntryLimit);
          }
          return {
            ...status,
            ...(options?.includeStatusEntries
              ? { statusEntries: { entries: [], totalCount: status.localChangeCount } }
              : {}),
          };
        },
      },
      settings: {
        load: async () => DEFAULT_WT_SETTINGS,
      },
      git: {
        ensureTaskArtifactsExcluded: async () => undefined,
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
      plugins: async () => ({
        open: async () => ({ openedBy: undefined, warnings: [] }),
        prepareRemoval: async () => async () => [],
      }),
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
    statusEntryInspectionLimits,
  };
}

describe("worktree removal", () => {
  test("resolves batch selectors once and removes the current checkout last", async () => {
    const fixture = createDependencies();
    fixture.dependencies.repository.requireContext = async () => ({ ...context, cwd: "/worktrees/feature-a" });
    fixture.dependencies.repository.loadWorktrees = async () => [
      createWorktree(),
      { ...createWorktree(), id: "other", path: "/worktrees/other", fullId: "project-other" },
    ];
    const removal = createWorktreeRemoval(fixture.dependencies);

    expect(await removal.orderTargets([".", "other", "feature-a", "missing"])).toEqual([
      "missing", "/worktrees/other", "/worktrees/feature-a",
    ]);
  });

  test("does not inspect status entries when removal details are not requested", async () => {
    const fixture = createDependencies();
    const removal = createWorktreeRemoval(fixture.dependencies);

    await removal.inspect("feature-a", context.cwd);

    expect(fixture.statusEntryInspectionLimits).toEqual([]);
  });

  test("bounds status entry inspection when removal details are requested", async () => {
    const fixture = createDependencies();
    const removal = createWorktreeRemoval(fixture.dependencies);

    await removal.inspect("feature-a", context.cwd, {
      includeStatusEntries: true,
    });

    expect(fixture.statusEntryInspectionLimits).toEqual([8]);
  });

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

  test("previews reuse known targets while execution rechecks the catalog and state", async () => {
    const fixture = createDependencies();
    const worktree = createWorktree();
    let contextReads = 0;
    let catalogReads = 0;
    fixture.dependencies.repository.requireContext = async () => {
      contextReads++;
      return context;
    };
    fixture.dependencies.repository.loadWorktrees = async () => {
      catalogReads++;
      return [worktree];
    };
    const removal = createWorktreeRemoval(fixture.dependencies);
    const inspectPreview = removal.createPreviewInspector(context, [worktree]);

    const plan = await inspectPreview(worktree.path);
    fixture.status.localChangeCount = 1;
    const updatedPreview = await inspectPreview(worktree.path);

    expect(plan.localChangeCount).toBe(0);
    expect(updatedPreview.localChangeCount).toBe(1);
    expect({ contextReads, catalogReads }).toEqual({ contextReads: 0, catalogReads: 0 });
    await expect(inspectPreview("/worktrees/not-in-plan")).rejects.toThrow("not in the cleanup plan");

    const result = await removal.execute(plan, { execution: "foreground" });

    expect(result.status).toBe("plan_stale");
    expect({ contextReads, catalogReads }).toEqual({ contextReads: 1, catalogReads: 1 });
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
    const outcomes: unknown[] = [];
    const startTask = fixture.dependencies.tasks.start;
    fixture.dependencies.tasks.start = (options) => {
      expect(fixture.changedDirectories).toEqual(["/repo"]);
      return startTask(options);
    };
    fixture.dependencies.plugins = async () => ({
      open: async () => ({ openedBy: undefined, warnings: [] }),
      prepareRemoval: async () => async (outcome) => {
        expect(fixture.startedTasks).toHaveLength(1);
        outcomes.push(outcome);
        return [];
      },
    });
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
    expect(fixture.changedDirectories).toEqual(["/repo"]);
    expect(outcomes).toEqual([{ status: "background_started", pid: 42 }]);
  });

  test("does not run removal callbacks when git removal fails", async () => {
    const fixture = createDependencies();
    const outcomes: unknown[] = [];
    fixture.dependencies.plugins = async () => ({
      open: async () => ({ openedBy: undefined, warnings: [] }),
      prepareRemoval: async () => async (outcome) => {
        outcomes.push(outcome);
        return [];
      },
    });
    fixture.dependencies.git.remove = async () => { throw new Error("worktree is locked"); };
    const removal = createWorktreeRemoval(fixture.dependencies);
    const plan = await removal.inspect("feature-a", context.cwd);

    await expect(removal.execute(plan, { execution: "foreground" })).rejects.toThrow("worktree is locked");

    expect(outcomes).toEqual([]);
    expect(fixture.deletedBranches).toEqual([]);
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

  test("returns partial failure and plugin warnings after removing the worktree", async () => {
    const fixture = createDependencies();
    fixture.dependencies.git.deleteBranch = async () => {
      throw new Error("branch is checked out elsewhere");
    };
    fixture.dependencies.plugins = async () => ({
      open: async () => ({ openedBy: undefined, warnings: [] }),
      prepareRemoval: async () => async (outcome) => {
        expect(outcome).toEqual({
          status: "worktree_removed_branch_failed",
          error: "branch is checked out elsewhere",
        });
        return [{ plugin: "editor", message: "Editor unavailable" }];
      },
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
          plugin: "editor",
          message: "Editor unavailable",
        },
      ],
    });
    expect(fixture.removedPaths).toEqual(["/worktrees/feature-a"]);
  });
});
