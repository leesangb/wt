import { describe, expect, test } from "bun:test";
import { DEFAULT_WT_SETTINGS } from "../domain/settings.js";
import {
  createWorktreeCreator,
  type WorktreeCreationDependencies,
} from "./worktree-creation.js";

function createNoopDependencies(): WorktreeCreationDependencies {
  return {
    settings: {
      load: async () => ({
        ...DEFAULT_WT_SETTINGS,
        worktreeDir: "/worktrees",
        pushRemote: false,
      }),
      resolveWorktreeDir: (path) => path,
    },
    files: {
      exists: () => false,
      ensureDirectory: () => undefined,
    },
    metadata: {
      read: async () => undefined,
      write: async () => undefined,
    },
    git: {
      fetchRemote: async () => undefined,
      fetchRemoteBranch: async () => true,
      getCommitHash: async () => "base-commit",
      getMergeBase: async () => "merge-base",
      resolveCommitHash: async () => ({
        commitHash: "base-commit",
        resolvedRef: "main",
      }),
      isRefAncestor: async () => true,
      localBranchExists: async () => false,
      createNew: async () => undefined,
      attachExisting: async () => undefined,
      createDetached: async () => undefined,
      checkoutPullRequest: async () => undefined,
      remove: async () => undefined,
      deleteBranch: async () => undefined,
    },
    scripts: {
      runPre: async () => undefined,
      runPost: async () => ({}),
    },
    copy: async () => undefined,
  };
}

const repositoryContext = {
  cwd: "/repo",
  repoRoot: "/repo",
  repoName: "project",
};

function createLifecycleDependencies(): {
  dependencies: WorktreeCreationDependencies;
  getStage: () => number;
  getWrittenMeta: () => unknown;
} {
  let stage = 0;
  let writtenMeta: unknown;

  return {
    dependencies: {
      settings: {
        load: async () => ({
          ...DEFAULT_WT_SETTINGS,
          worktreeDir: "/worktrees",
          pushRemote: false,
          scripts: {
            pre: ["prepare"],
            post: ["finish"],
            postMode: "sync",
          },
        }),
        resolveWorktreeDir: (path) => path,
      },
      files: {
        exists: () => false,
        ensureDirectory: () => undefined,
      },
      metadata: {
        read: async () => undefined,
        write: async (_path, meta) => {
          expect(stage).toBe(3);
          writtenMeta = meta;
          stage = 4;
        },
      },
      git: {
        fetchRemote: async () => undefined,
        fetchRemoteBranch: async () => true,
        getCommitHash: async () => "base-commit",
        getMergeBase: async () => "base-commit",
        resolveCommitHash: async () => ({
          commitHash: "base-commit",
          resolvedRef: "main",
        }),
        isRefAncestor: async () => true,
        localBranchExists: async () => false,
        createNew: async () => {
          expect(stage).toBe(1);
          stage = 2;
        },
        attachExisting: async () => undefined,
        createDetached: async () => undefined,
        checkoutPullRequest: async () => undefined,
        remove: async () => undefined,
        deleteBranch: async () => undefined,
      },
      scripts: {
        runPre: async () => {
          expect(stage).toBe(0);
          stage = 1;
        },
        runPost: async () => {
          expect(stage).toBe(4);
          stage = 5;
          return { postMode: "sync" };
        },
      },
      copy: async () => {
        expect(stage).toBe(2);
        stage = 3;
      },
    },
    getStage: () => stage,
    getWrittenMeta: () => writtenMeta,
  };
}

describe("worktree creation", () => {
  test("creates a new worktree through one lifecycle", async () => {
    const fixture = createLifecycleDependencies();
    const create = createWorktreeCreator(fixture.dependencies);

    const result = await create({
      kind: "new",
      context: repositoryContext,
      branchName: "feature/a",
      options: {
        base: "main",
        id: "feature/a",
        push: false,
      },
    });

    expect(result).toEqual({
      branchName: "feature/a",
      id: "feature/a",
      fullId: "project-feature/a",
      worktreePath: "/worktrees/project-feature-a",
      baseBranch: "main",
      baseCommit: "base-commit",
      postMode: "sync",
    });
    expect(fixture.getWrittenMeta()).toMatchObject({
      id: "feature/a",
      fullId: "project-feature/a",
      baseBranch: "main",
      baseCommit: "base-commit",
    });
    expect(fixture.getStage()).toBe(5);
  });

  test("creates a worktree for an existing branch with an adjusted id", async () => {
    const dependencies = createNoopDependencies();
    dependencies.scripts.runPost = async () => ({
      postMode: "async",
      postTask: {
        pid: 42,
        statusFilePath: "/worktrees/task.json",
        logFilePath: "/worktrees/task.log",
      },
    });
    const create = createWorktreeCreator(dependencies);

    const result = await create({
      kind: "existing-branch",
      context: repositoryContext,
      branchName: "feature/a",
      existingIds: ["feature/a"],
    });

    expect(result).toEqual({
      branchName: "feature/a",
      id: "feature/a-1",
      fullId: "project-feature/a-1",
      worktreePath: "/worktrees/project-feature-a-1",
      baseBranch: "main",
      baseCommit: "merge-base",
      idAdjustedFrom: "feature/a",
      postMode: "async",
      postTask: {
        pid: 42,
        statusFilePath: "/worktrees/task.json",
        logFilePath: "/worktrees/task.log",
      },
    });
  });

  test("rolls back a temporary pull request worktree when checkout fails", async () => {
    const dependencies = createNoopDependencies();
    const removedPaths: string[] = [];
    const deletedBranches: string[] = [];
    let branchLookupCount = 0;
    dependencies.git.localBranchExists = async () => {
      branchLookupCount += 1;
      return branchLookupCount > 1;
    };
    dependencies.git.checkoutPullRequest = async () => {
      throw new Error("checkout failed");
    };
    dependencies.git.remove = async (_repoRoot, worktreePath) => {
      removedPaths.push(worktreePath);
    };
    dependencies.git.deleteBranch = async (_repoRoot, branch) => {
      deletedBranches.push(branch);
    };
    const create = createWorktreeCreator(dependencies);

    await expect(
      create({
        kind: "pull-request",
        context: repositoryContext,
        pullRequest: {
          baseRefName: "main",
          headRefName: "feature/pr",
          headRefOid: "head-commit",
          number: "17",
          url: "https://example.test/pull/17",
        },
        existingIds: [],
      })
    ).rejects.toThrow("checkout failed");
    expect(removedPaths).toEqual(["/worktrees/project-pr-17"]);
    expect(deletedBranches).toEqual(["feature/pr"]);
  });

  test("does not materialize a worktree when a pre script fails", async () => {
    const dependencies = createNoopDependencies();
    let materialized = false;
    dependencies.scripts.runPre = async () => {
      throw new Error("pre failed");
    };
    dependencies.git.createNew = async () => {
      materialized = true;
    };
    const create = createWorktreeCreator(dependencies);

    await expect(
      create({
        kind: "new",
        context: repositoryContext,
        branchName: "feature/a",
        options: {},
      })
    ).rejects.toThrow("pre failed");
    expect(materialized).toBe(false);
  });

  test("keeps the created worktree when copying configured paths fails", async () => {
    const dependencies = createNoopDependencies();
    let materialized = false;
    let metadataWritten = false;
    let removed = false;
    dependencies.git.createNew = async () => {
      materialized = true;
    };
    dependencies.copy = async () => {
      throw new Error("copy failed");
    };
    dependencies.metadata.write = async () => {
      metadataWritten = true;
    };
    dependencies.git.remove = async () => {
      removed = true;
    };
    const create = createWorktreeCreator(dependencies);

    await expect(
      create({
        kind: "new",
        context: repositoryContext,
        branchName: "feature/a",
        options: {},
      })
    ).rejects.toThrow("copy failed");
    expect(materialized).toBe(true);
    expect(metadataWritten).toBe(false);
    expect(removed).toBe(false);
  });
});
