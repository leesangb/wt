import { listCachedOpenPullRequests } from "../../infra/github/completion-cache.js";
import { requireRepositoryRoot } from "../repository-context.js";

export async function listOpenPullRequestsForCompletion(
  cwd: string = process.cwd()
) {
  const repoRoot = await requireRepositoryRoot(cwd);
  return listCachedOpenPullRequests(repoRoot);
}
