import { requireRepositoryContext } from "../app/repository-context.js";
import { loadWorktreeInfos } from "../app/worktree-catalog.js";
import {
  createGitWorktree,
  deleteBranch as deleteBranchByRepoRoot,
  fetchRemote as fetchRemoteByRepoRoot,
  listGitWorktrees,
  removeGitWorktree,
} from "../infra/git/worktree-repository.js";
import {
  getCommitHash as getCommitHashByRepoRoot,
  getDefaultRemoteBranch as getDefaultRemoteBranchByRepoRoot,
  getMergedRemoteBranches as getMergedRemoteBranchesByRepoRoot,
  getWorktreeStatusSummary,
  isBranchMergedToRemote as isBranchMergedToRemoteByRepoRoot,
} from "../infra/git/status.js";
export { getWorktreeStatusSummary };
export {
  getGitRoot,
  getRepoName,
  isGitRepository,
} from "../infra/git/repository.js";

export async function fetchRemote(): Promise<void> {
  const context = await requireRepositoryContext();
  await fetchRemoteByRepoRoot(context.repoRoot);
}

export async function createWorktree(
  path: string,
  branch: string,
  base: string,
  pushRemote: boolean = true
): Promise<void> {
  const context = await requireRepositoryContext();
  await createGitWorktree(context.repoRoot, path, branch, base, pushRemote);
}

export async function listWorktrees() {
  const context = await requireRepositoryContext();
  return loadWorktreeInfos(context);
}

export async function removeWorktree(path: string): Promise<void> {
  const context = await requireRepositoryContext();
  await removeGitWorktree(context.repoRoot, path);
}

export async function deleteBranch(branch: string): Promise<void> {
  const context = await requireRepositoryContext();
  await deleteBranchByRepoRoot(context.repoRoot, branch);
}

export async function getDefaultRemoteBranch(): Promise<string | undefined> {
  const context = await requireRepositoryContext();
  return getDefaultRemoteBranchByRepoRoot(context.repoRoot);
}

export async function getMergedRemoteBranches(
  baseBranch?: string
): Promise<Set<string>> {
  const context = await requireRepositoryContext();
  return getMergedRemoteBranchesByRepoRoot(context.repoRoot, baseBranch);
}

export async function isBranchMergedToRemote(
  branch: string,
  baseBranch?: string
): Promise<boolean> {
  const context = await requireRepositoryContext();
  return isBranchMergedToRemoteByRepoRoot(
    context.repoRoot,
    branch,
    baseBranch
  );
}

export async function getLocalModificationCount(path: string): Promise<number> {
  const summary = await getWorktreeStatusSummary(path, "HEAD");
  return summary.modifiedCount;
}

export async function getCommitHash(ref: string): Promise<string> {
  const context = await requireRepositoryContext();
  return getCommitHashByRepoRoot(context.repoRoot, ref);
}

export { listGitWorktrees };
