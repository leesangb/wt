import chalk from "chalk";
import { readFileSync } from "fs";
import { createInterface } from "readline/promises";
import { AppError } from "../app/errors.js";
import {
  inspectRemoveWorktree,
  RemoveWorktreeError,
  removeWorktree,
} from "../app/use-cases/remove-worktree.js";
import { runCommand } from "../cli/command-runtime.js";
import { runWithSpinner } from "../cli/spinner.js";
import { emitShellCd } from "../infra/shell/cd.js";

interface RemoveCommandOptions {
  keepBranch?: boolean;
  force?: boolean;
}

interface RemovalPrompter {
  confirmRemoval: (
    worktreeId: string,
    branch: string,
    localChangeCount: number,
    localCommitCount: number,
    hasUnknownLocalCommits: boolean
  ) => Promise<boolean>;
  close: () => void;
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

function createRemovalPrompter(): RemovalPrompter {
  let readline: ReturnType<typeof createInterface> | undefined;
  let bufferedAnswers: string[] | undefined;

  const getReadline = () => {
    if (!readline) {
      readline = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    return readline;
  };

  const getBufferedAnswers = () => {
    if (!bufferedAnswers) {
      bufferedAnswers = readFileSync(0, "utf-8").split(/\r?\n/);
    }

    return bufferedAnswers;
  };

  return {
    async confirmRemoval(
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

      try {
        console.log(
          chalk.yellow(
            `Warning: ${branch} (${worktreeId}) has ${summary}.`
          )
        );
        const prompt = chalk.yellow("Remove this worktree anyway? [y/N] ");
        const answer = process.stdin.isTTY
          ? await getReadline().question(prompt)
          : (() => {
              process.stdout.write(prompt);
              return getBufferedAnswers().shift() ?? "";
            })();

        return /^(y|yes)$/i.test(answer.trim());
      } catch {
        return false;
      }
    },
    close() {
      readline?.close();
    },
  };
}

function hasPendingWork(preview: Awaited<ReturnType<typeof inspectRemoveWorktree>>): boolean {
  return (
    preview.localChangeCount > 0 ||
    preview.localCommitCount > 0 ||
    preview.hasUnknownLocalCommits
  );
}

function logRemovalResult(
  result: Awaited<ReturnType<typeof removeWorktree>>
): void {
  console.log(
    chalk.green(
      `✓ Worktree removed: ${result.worktree.branch} (${result.worktree.id})`
    )
  );

  if (result.branchDeleted) {
    console.log(chalk.green(`✓ Branch deleted: ${result.worktree.branch}`));
  } else {
    console.log(chalk.yellow(`Branch kept: ${result.worktree.branch}`));
  }

  if (result.relocatedToPath) {
    emitShellCd(result.relocatedToPath);
  }
}

async function removeSingleWorktree(
  id: string,
  options: RemoveCommandOptions,
  batchMode: boolean,
  prompter: RemovalPrompter
): Promise<"removed" | "skipped"> {
  const preview = await inspectRemoveWorktree(id);

  if (hasPendingWork(preview) && !options.force) {
    const confirmed = await prompter.confirmRemoval(
      preview.worktree.id,
      preview.worktree.branch,
      preview.localChangeCount,
      preview.localCommitCount,
      preview.hasUnknownLocalCommits
    );

    if (!confirmed) {
      if (!batchMode) {
        throw new AppError("Removal cancelled");
      }

      console.log(
        chalk.yellow(
          `Skipped worktree: ${preview.worktree.branch} (${preview.worktree.id})`
        )
      );
      return "skipped";
    }
  }

  const result = await runWithSpinner(
    `Removing worktree ${preview.worktree.branch} (${preview.worktree.id})`,
    async () => {
      try {
        return await removeWorktree(preview.worktree.id, options);
      } catch (error) {
        if (error instanceof RemoveWorktreeError && error.relocatedToPath) {
          emitShellCd(error.relocatedToPath);
        }

        throw error;
      }
    }
  );
  logRemovalResult(result);
  return "removed";
}

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
