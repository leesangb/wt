import type { CreateWorktreeResult } from "../worktree-creation.js";
import {
  openHerdrWorktree,
  type OpenHerdrWorktreeResult,
} from "../../infra/herdr/client.js";

export async function openCreatedWorktreeInHerdr(
  worktree: Pick<CreateWorktreeResult, "id" | "worktreePath">,
  options: { focus?: boolean; label?: string } = {}
): Promise<OpenHerdrWorktreeResult> {
  const { label = worktree.id, ...herdrOptions } = options;

  return openHerdrWorktree(worktree.worktreePath, label, herdrOptions);
}
