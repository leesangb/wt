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
  localChangeCount: number,
  localCommitCount: number,
  hasUnknownLocalCommits: boolean
): string {
  const details: string[] = [];

  if (localChangeCount > 0) {
    details.push(
      `${localChangeCount} ${localChangeCount === 1 ? "local change" : "local changes"}`
    );
  }

  if (localCommitCount > 0) {
    details.push(
      `${localCommitCount} ${
        localCommitCount === 1 ? "local commit not on the base or upstream branch" : "local commits not on the base or upstream branch"
      }`
    );
  }

  if (hasUnknownLocalCommits) {
    details.push("commits that could not be compared safely");
  }

  return details.join(" and ");
}

async function confirmRemoval(
  worktreeId: string,
  branch: string,
  localChangeCount: number,
  localCommitCount: number,
  hasUnknownLocalCommits: boolean
): Promise<boolean> {
  const summary = buildPendingWorkSummary(
    localChangeCount,
    localCommitCount,
    hasUnknownLocalCommits
  );
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
      preview.localChangeCount > 0 ||
      preview.localCommitCount > 0 ||
      preview.hasUnknownLocalCommits;

    if (hasPendingWork && !options.force) {
      const confirmed = await confirmRemoval(
        preview.worktree.id,
        preview.worktree.branch,
        preview.localChangeCount,
        preview.localCommitCount,
        preview.hasUnknownLocalCommits
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
