import type { CreateWorktreeResult } from "../worktree-creation.js";
import {
  openHerdrWorktree,
  type OpenHerdrWorktreeResult,
} from "../../infra/herdr/client.js";

export async function openCreatedWorktreeInHerdr(
  worktree: Pick<CreateWorktreeResult, "id" | "worktreePath">
): Promise<OpenHerdrWorktreeResult> {
  return openHerdrWorktree(worktree.worktreePath, worktree.id);
}
