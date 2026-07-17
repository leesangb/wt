import { listOpenPullRequests } from "../../infra/github/cli.js";
import { requireRepositoryContext } from "../repository-context.js";

export async function listOpenPullRequestsForCompletion(
  cwd: string = process.cwd()
) {
  const context = await requireRepositoryContext(cwd);
  return listOpenPullRequests(context.repoRoot);
}
