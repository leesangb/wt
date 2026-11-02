import { realpathSync } from "node:fs";
import type { Plugin } from "../plugin.js";

const rex: Plugin = ({ env, $, repoRoot }) => {
  const session = env.REX_SESSION;
  if (!session) return {};

  const callRex = async (method: string, args: Record<string, unknown>) => {
    const json = JSON.stringify(args);
    const result = await $`rex --autostart=false api call -s ${session} ${method} ${json}`.nothrow();
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString().trim() || `rex exited with code ${result.exitCode}`);
    }
    return result;
  };

  const findWindow = async (blockId: string) => {
    const result = await callRex("session.describe_block", { block_id: blockId });
    const response: unknown = result.json();
    if (!response || typeof response !== "object" || !("block" in response)) {
      throw new Error("Rex did not return the invoking pane");
    }
    const block = response.block;
    if (
      !block || typeof block !== "object" ||
      !("block_id" in block) || block.block_id !== blockId ||
      !("window_id" in block) || typeof block.window_id !== "string" ||
      !block.window_id.startsWith("window:")
    ) {
      throw new Error("Rex did not return a tab for the invoking pane");
    }
    return block.window_id;
  };

  return {
    "worktree.open": async ({ path, label, focus }) => {
      const windowLabel = Array.from(label.replace(/\p{Cc}/gu, " ").trim())
        .slice(0, 128)
        .join("");
      await callRex("session.new_window", {
        window_label: windowLabel,
        focus,
        layout: {
          block: {
            flavor: "com.superlogical.terminal.shell",
            options: { cwd: path },
          },
        },
      });
      return "handled" as const;
    },
    "worktree.remove.before": async ({ path }) => {
      const block = env.REX_BLOCK;
      if (!block || realpathSync(path) !== realpathSync(repoRoot)) return;
      const windowId = await findWindow(block);

      return async () => {
        if (await findWindow(block) !== windowId) {
          throw new Error("Rex pane moved to another tab; leaving the tabs open");
        }
        await callRex("session.close_window", { window_id: windowId });
      };
    },
  };
};

export default rex;
