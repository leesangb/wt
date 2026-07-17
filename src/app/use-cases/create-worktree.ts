import {
  createPreparedWorktree,
  type CreateWorktreeResult,
} from "../worktree-creation.js";
import { requireRepositoryContext } from "../repository-context.js";

export interface CreateWorktreeOptions {
  base?: string;
  push?: boolean;
  id?: string;
}

export async function createWorktree(
  branchName: string,
  options: CreateWorktreeOptions,
  cwd: string = process.cwd()
): Promise<CreateWorktreeResult> {
  const context = await requireRepositoryContext(cwd);

  return createPreparedWorktree({
    kind: "new",
    context,
    branchName,
    options,
  });
}
