import { AppError } from "./errors.js";
import {
  getGitRoot,
  getRepoName,
  isGitRepository,
} from "../infra/git/repository.js";

export interface RepositoryContext {
  cwd: string;
  repoRoot: string;
  repoName: string;
}

export async function requireRepositoryContext(
  cwd: string = process.cwd()
): Promise<RepositoryContext> {
  if (!(await isGitRepository(cwd))) {
    throw new AppError("Not a git repository");
  }

  const repoRoot = await getGitRoot(cwd);
  const repoName = await getRepoName(repoRoot);

  return {
    cwd,
    repoRoot,
    repoName,
  };
}
