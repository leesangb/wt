import type { Plugin } from "../plugin.js";

const rex: Plugin = ({ env, $ }) => {
  const session = env.REX_SESSION;
  if (!session) return {};

  return {
    "worktree.open": async ({ path, label, focus }) => {
      const windowLabel = Array.from(label.replace(/\p{Cc}/gu, " ").trim())
        .slice(0, 128)
        .join("");
      const args = JSON.stringify({
        window_label: windowLabel,
        focus,
        layout: {
          block: {
            flavor: "com.superlogical.terminal.shell",
            options: { cwd: path },
          },
        },
      });
      const result = await $`rex --autostart=false api call -s ${session} session.new_window ${args}`.nothrow();
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.toString().trim() || `rex exited with code ${result.exitCode}`);
      }
      return "handled" as const;
    },
  };
};

export default rex;
