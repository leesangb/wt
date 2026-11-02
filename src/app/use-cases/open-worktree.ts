import type { CreateWorktreeResult } from "../worktree-creation.js";
import { requireRepositoryContext } from "../repository-context.js";
import { loadSettings } from "../../infra/storage/settings-store.js";
import { loadWorktreePlugins } from "../worktree-plugins.js";

export async function openCreatedWorktree(
  worktree: Pick<CreateWorktreeResult, "id" | "worktreePath" | "branchName">,
  options: { focus?: boolean; label?: string; open?: boolean } = {},
  cwd = process.cwd()
) {
  if (options.open === false) return { openedBy: undefined, warnings: [] };
  const { repoRoot } = await requireRepositoryContext(cwd);
  const settings = await loadSettings(repoRoot);
  const plugins = await loadWorktreePlugins({ repoRoot, settings, cwd });
  return plugins.open({
    id: worktree.id,
    path: worktree.worktreePath,
    branch: worktree.branchName,
    label: options.label ?? worktree.id,
    focus: options.focus !== false,
  });
}
