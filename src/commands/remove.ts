import chalk from "chalk";
import { runCommand } from "../cli/command-runtime.js";
import {
  createRemovalPrompter,
  type RemoveCommandOptions,
  removeSingleWorktree,
} from "./remove-shared.js";

export async function removeCommand(
  ids: string[],
  options: RemoveCommandOptions
): Promise<void> {
  await runCommand(async () => {
    const prompter = createRemovalPrompter();

    try {
      if (ids.length === 1) {
        await removeSingleWorktree(ids[0], options, false, prompter);
        return;
      }

      let hadSkippedOrFailedTargets = false;

      for (const [index, id] of ids.entries()) {
        if (index > 0) {
          console.log("");
        }

        try {
          const result = await removeSingleWorktree(id, options, true, prompter);
          if (result === "skipped") {
            hadSkippedOrFailedTargets = true;
          }
        } catch (error) {
          hadSkippedOrFailedTargets = true;
          const message = error instanceof Error ? error.message : String(error);
          console.error(chalk.red(`Error removing "${id}": ${message}`));
        }
      }

      if (hadSkippedOrFailedTargets) {
        process.exitCode = 1;
      }
    } finally {
      prompter.close();
    }
  });
}
