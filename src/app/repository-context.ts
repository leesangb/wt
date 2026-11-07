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

export async function requireRepositoryRoot(
  cwd: string = process.cwd()
): Promise<string> {
  try {
    return await getGitRoot(cwd);
  } catch (error) {
    if (!(await isGitRepository(cwd))) {
      throw new AppError("Not a git repository");
    }
    throw error;
  }
}

export async function requireRepositoryContext(
  cwd: string = process.cwd()
): Promise<RepositoryContext> {
  const repoRoot = await requireRepositoryRoot(cwd);
  const repoName = await getRepoName(repoRoot);

  return { cwd, repoRoot, repoName };
}
