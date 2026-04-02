import chalk from "chalk";
import { AppError } from "../app/errors.js";
import { getWorktreeBranchLabel } from "../domain/worktree.js";
import {
  listRemoveCompletionWorktrees,
  listWorktreeInfos,
  listWorktrees,
} from "../app/use-cases/list-worktrees.js";
import type {
  WorktreeInfo,
  WorktreeRemovalInfo,
  WorktreeState,
} from "../types/index.js";
import { runCommand } from "../cli/command-runtime.js";
import {
  buildBaseDescription,
  buildWorktreeBranchSummary,
  buildWorktreeIdLabel,
} from "./worktree-display.js";

type CompletionFormat = "bash" | "zsh" | "fish";

const COMPLETION_FORMATS = new Set<CompletionFormat>(["bash", "zsh", "fish"]);

function assertCompletionFormat(
  value: string
): asserts value is CompletionFormat {
  if (COMPLETION_FORMATS.has(value as CompletionFormat)) {
    return;
  }

  throw new AppError(
    `Unsupported completion format "${value}". Expected one of: bash, zsh, fish.`
  );
}

export async function listCommand(options?: {
  completion?: string;
  excludeMainWorktree?: boolean;
}): Promise<void> {
  await runCommand(async () => {
    if (options?.completion) {
      assertCompletionFormat(options.completion);
      const useRemovalCompletionDescriptions = options.excludeMainWorktree;

      if (useRemovalCompletionDescriptions) {
        const result = await listRemoveCompletionWorktrees(process.cwd(), {
          excludeMainWorktree: options.excludeMainWorktree,
        });

        for (const worktree of result.worktrees) {
          const description = buildRemoveCompletionDescription(worktree);

          if (options.completion === "fish") {
            console.log(`${worktree.id}\t${description}`);
          } else {
            console.log(`${worktree.id}:${description}`);
          }
        }
      } else {
        const result = await listWorktreeInfos(process.cwd(), {
          excludeMainWorktree: options.excludeMainWorktree,
        });

        for (const worktree of result.worktrees) {
          const description = buildDefaultCompletionDescription(worktree);

          if (options.completion === "fish") {
            console.log(`${worktree.id}\t${description}`);
          } else {
            console.log(`${worktree.id}:${description}`);
          }
        }
      }
      return;
    }

    const result = await listWorktrees();

    if (result.worktrees.length === 0) {
      console.log(chalk.yellow("No worktrees found"));
      return;
    }

    console.log(chalk.bold(`\nWorktrees (${result.repoName}):`));
    console.log(chalk.dim("─".repeat(80)));

    for (const worktree of result.worktrees) {
      const idLabel = buildWorktreeIdLabel(worktree);
      const timestamp = new Date(worktree.createdAt).toLocaleString();

      console.log(chalk.cyan(`ID:      ${idLabel}`));
      console.log(
        chalk.white(`Branch:  ${buildWorktreeBranchSummary(worktree)}`)
      );
      console.log(chalk.dim(`Path:    ${worktree.path}`));
      console.log(chalk.dim(`Created: ${timestamp}`));
      console.log(chalk.dim("─".repeat(80)));
    }
  });
}

function buildDefaultCompletionDescription(worktree: WorktreeInfo): string {
  const descriptionParts = [getWorktreeBranchLabel(worktree)];
  const baseDescription = buildBaseDescription(worktree);

  if (baseDescription) {
    descriptionParts.push(baseDescription);
  }

  return descriptionParts.join(" ");
}

function buildRemoveCompletionDescription(
  worktree: WorktreeRemovalInfo
): string {
  const metadata: string[] = [];

  if (worktree.mergeStatus === "merged") {
    metadata.push("merged");
  } else if (worktree.mergeStatus === "not_merged") {
    metadata.push("not merged");
  }

  const baseDescription = buildBaseDescription(worktree);
  if (baseDescription) {
    metadata.push(baseDescription);
  }

  if (metadata.length === 0) {
    return getWorktreeBranchLabel(worktree);
  }

  return `${getWorktreeBranchLabel(worktree)} | ${metadata.join(" | ")}`;
}
