import chalk from "chalk";
import { createInterface } from "readline/promises";
import { AppError } from "../app/errors.js";
import {
  inspectRemoveWorktree,
  removeWorktree,
} from "../app/use-cases/remove-worktree.js";
import { runCommand } from "../cli/command-runtime.js";
interface RemoveCommandOptions {
  keepBranch?: boolean;
  force?: boolean;
}

function buildPendingWorkSummary(
  modifiedCount: number,
  unpushedCount: number
): string {
  const details: string[] = [];

  if (modifiedCount > 0) {
    details.push(
      `${modifiedCount} ${modifiedCount === 1 ? "modified file" : "modified files"}`
    );
  }

  if (unpushedCount > 0) {
    details.push(
      `${unpushedCount} ${unpushedCount === 1 ? "unpushed commit" : "unpushed commits"}`
    );
  }

  return details.join(" and ");
}

async function confirmRemoval(
  worktreeId: string,
  branch: string,
  modifiedCount: number,
  unpushedCount: number
): Promise<boolean> {
  const summary = buildPendingWorkSummary(modifiedCount, unpushedCount);
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log(
      chalk.yellow(
        `Warning: ${branch} (${worktreeId}) has ${summary}.`
      )
    );
    const answer = await readline.question(
      chalk.yellow("Remove this worktree anyway? [y/N] ")
    );

    return /^(y|yes)$/i.test(answer.trim());
  } catch {
    return false;
  } finally {
    readline.close();
  }
}

export async function removeCommand(id: string, options: RemoveCommandOptions): Promise<void> {
  await runCommand(async () => {
    const preview = await inspectRemoveWorktree(id);
    const hasPendingWork =
      preview.modifiedCount > 0 || preview.unpushedCount > 0;

    if (hasPendingWork && !options.force) {
      const confirmed = await confirmRemoval(
        preview.worktree.id,
        preview.worktree.branch,
        preview.modifiedCount,
        preview.unpushedCount
      );

      if (!confirmed) {
        throw new AppError("Removal cancelled");
      }
    }

    const result = await removeWorktree(id, options);

    console.log(
      chalk.blue(
        `Removing worktree: ${result.worktree.branch} (${result.worktree.id})...`
      )
    );
    console.log(chalk.green(`✓ Worktree removed`));

    if (result.branchDeleted) {
      console.log(chalk.blue(`Deleting branch: ${result.worktree.branch}...`));
      console.log(chalk.green(`✓ Branch deleted`));
      return;
    }

    console.log(chalk.yellow(`Branch ${result.worktree.branch} kept`));
  });
}
