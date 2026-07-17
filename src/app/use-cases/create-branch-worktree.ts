import {
  createPreparedWorktree,
  type CreateWorktreeResult,
} from "../worktree-creation.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadWorktreeInfos } from "../worktree-catalog.js";
import { localBranchExists } from "../../infra/git/worktree-repository.js";
import { AppError } from "../errors.js";

function normalizeBranchName(branchName: string): string {
  const value = branchName.trim();

  if (!value) {
    throw new AppError("Branch name is required");
  }

  return value;
}

export async function createBranchWorktree(
  branchName: string,
  cwd: string = process.cwd()
): Promise<CreateWorktreeResult> {
  const normalizedBranchName = normalizeBranchName(branchName);
  const context = await requireRepositoryContext(cwd);
  const worktrees = await loadWorktreeInfos(context);
  const existingWorktree = worktrees.find(
    (worktree) => worktree.branch === normalizedBranchName
  );

  if (existingWorktree) {
    return {
      branchName: normalizedBranchName,
      id: existingWorktree.id,
      fullId: existingWorktree.fullId,
      worktreePath: existingWorktree.path,
      baseBranch: existingWorktree.baseBranch ?? "",
      baseCommit: existingWorktree.baseCommit ?? "",
      reusedExisting: true,
    };
  }

  if (!(await localBranchExists(context.repoRoot, normalizedBranchName))) {
    throw new AppError(
      `Local branch ${normalizedBranchName} does not exist. Use "wt new ${normalizedBranchName}" to create it first.`
    );
  }

  return createPreparedWorktree({
    kind: "existing-branch",
    context,
    branchName: normalizedBranchName,
    existingIds: worktrees.map((worktree) => worktree.id),
  });
}
