import type { Plugin } from "../plugin.js";
import {
  closeHerdrWorkspace,
  findHerdrWorkspaceForWorktree,
  openHerdrWorktree,
} from "../infra/herdr/client.js";

const herdr: Plugin = ({ env, settings }) => {
  if (env.HERDR_ENV !== "1" || !env.HERDR_WORKSPACE_ID) return {};

  return {
    "worktree.open": async ({ path, label, focus }) => {
      const result = await openHerdrWorktree(path, label, { focus }, env);
      if (result.error) throw new Error(result.error);
      return result.opened ? "handled" : "skipped";
    },
    "worktree.remove.before": async ({ path }) => {
      if (!settings.herdr.closeWorkspaceOnRemove) return;
      const workspace = await findHerdrWorkspaceForWorktree(path, env);
      if (workspace.error) throw new Error(workspace.error);
      if (!workspace.workspaceId) return;

      return async () => {
        const result = await closeHerdrWorkspace(workspace.workspaceId, env);
        if (result.error) throw new Error(result.error);
      };
    },
  };
};

export default herdr;
