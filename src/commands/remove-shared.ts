import chalk from "chalk";
import { createInterface } from "readline/promises";
import { AppError } from "../app/errors.js";
import { getWorktreeBranchLabel } from "../domain/worktree.js";
import {
  executeRemoval,
  inspectRemoval,
  type BackgroundRemovalResult,
  type RemovalPlan,
  type RemovalResult,
  type RemovedWorktreeResult,
} from "../app/use-cases/remove-worktree.js";
import { runWithSpinner } from "../cli/spinner.js";
import { emitShellCd } from "../infra/shell/cd.js";

export interface RemoveCommandOptions {
  keepBranch?: boolean;
  force?: boolean;
  foreground?: boolean;
}

export interface RemovalPrompter {
  confirmCleanup: (worktreeCount: number) => Promise<boolean>;
  confirmRemoval: (
    worktreeId: string,
    branch: string,
    localChangeCount: number,
    localCommitCount: number,
    hasUnknownLocalCommits: boolean
  ) => Promise<boolean>;
  confirmChangedRemoval: (
    worktreeId: string,
    branch: string,
    localChangeCount: number,
    localCommitCount: number,
    hasUnknownLocalCommits: boolean
  ) => Promise<boolean>;
  close: () => void;
}

export function buildPendingWorkSummary(
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
        localCommitCount === 1
          ? "local commit not on the base or upstream branch"
          : "local commits not on the base or upstream branch"
      }`
    );
  }

  if (hasUnknownLocalCommits) {
    details.push("commits that could not be compared safely");
  }

  return details.join(" and ");
}

export function createRemovalPrompter(): RemovalPrompter {
  let readline: ReturnType<typeof createInterface> | undefined;
  let bufferedInput = "";
  let inputEnded = false;
  let dataHandlerAttached = false;
  const pendingResolvers: Array<() => void> = [];

  const getReadline = () => {
    if (!readline) {
      readline = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
    }

    return readline;
  };

  const resolvePendingReads = () => {
    while (pendingResolvers.length > 0) {
      if (!inputEnded && !bufferedInput.includes("\n")) {
        return;
      }

      pendingResolvers.shift()?.();
    }
  };

  const ensureDataHandler = () => {
    if (dataHandlerAttached) {
      return;
    }

    dataHandlerAttached = true;
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", handleData);
    process.stdin.on("end", handleEnd);
    process.stdin.resume();
  };

  const handleData = (chunk: string | Buffer) => {
    bufferedInput += chunk.toString();
    resolvePendingReads();
  };

  const handleEnd = () => {
    inputEnded = true;
    resolvePendingReads();
  };

  const takeBufferedLine = (): string | undefined => {
    const newlineIndex = bufferedInput.indexOf("\n");

    if (newlineIndex >= 0) {
      const line = bufferedInput.slice(0, newlineIndex).replace(/\r$/, "");
      bufferedInput = bufferedInput.slice(newlineIndex + 1);
      return line;
    }

    if (inputEnded) {
      const line = bufferedInput.replace(/\r$/, "");
      bufferedInput = "";
      return line;
    }

    return undefined;
  };

  const readLineFromStdin = async (): Promise<string> => {
    ensureDataHandler();
    const bufferedLine = takeBufferedLine();

    if (bufferedLine !== undefined) {
      return bufferedLine;
    }

    await new Promise<void>((resolve) => pendingResolvers.push(resolve));
    return takeBufferedLine() ?? "";
  };

  const confirmAction = async (prompt: string): Promise<boolean> => {
    try {
      const answer = await (
        process.stdin.isTTY
          ? getReadline().question(chalk.yellow(prompt))
          : (() => {
              process.stdout.write(chalk.yellow(prompt));
              return readLineFromStdin();
            })()
      );

      return /^(y|yes)$/i.test(answer.trim());
    } catch {
      return false;
    }
  };

  return {
    async confirmCleanup(worktreeCount: number): Promise<boolean> {
      return confirmAction(
        `Proceed with cleanup of ${worktreeCount} ${
          worktreeCount === 1 ? "worktree" : "worktrees"
        }? [y/N] `
      );
    },
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

      console.log(
        chalk.yellow(`Warning: ${branch} (${worktreeId}) has ${summary}.`)
      );

      return confirmAction("Remove this worktree anyway? [y/N] ");
    },
    async confirmChangedRemoval(
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
      const pendingMessage = summary ? ` It now has ${summary}.` : "";

      console.log(
        chalk.yellow(
          `Warning: ${branch} (${worktreeId}) changed after confirmation.${pendingMessage}`
        )
      );

      return confirmAction("Review the latest state and remove it anyway? [y/N] ");
    },
    close() {
      readline?.close();
      if (dataHandlerAttached) {
        process.stdin.off("data", handleData);
        process.stdin.off("end", handleEnd);
      }
    },
  };
}

export function hasPendingWork(
  preview: RemovalPlan
): boolean {
  return (
    preview.localChangeCount > 0 ||
    preview.localCommitCount > 0 ||
    preview.hasUnknownLocalCommits
  );
}

export function logRemovalResult(
  result: RemovedWorktreeResult
): void {
  const branchLabel = getWorktreeBranchLabel(result.worktree);

  console.log(
    chalk.green(`✓ Worktree removed: ${branchLabel} (${result.worktree.id})`)
  );

  if (result.worktree.branch && result.branchDeleted) {
    console.log(chalk.green(`✓ Branch deleted: ${result.worktree.branch}`));
  } else if (result.worktree.branch) {
    console.log(chalk.yellow(`Branch kept: ${result.worktree.branch}`));
  } else {
    console.log(chalk.dim("Detached worktree had no branch to delete"));
  }

  if (result.relocatedToPath) {
    emitShellCd(result.relocatedToPath);
  }
}

export function logBackgroundRemovalResult(
  result: BackgroundRemovalResult
): void {
  const branchLabel = getWorktreeBranchLabel(result.worktree);

  console.log(
    chalk.blue(
      `Started background removal: ${branchLabel} (${result.worktree.id})`
    )
  );
  console.log(chalk.dim(`  PID: ${result.pid}`));
  console.log(chalk.dim(`  Status: ${result.statusFilePath}`));
  console.log(chalk.dim(`  Log: ${result.logFilePath}`));

  if (result.branchDeleteQueued && result.worktree.branch) {
    console.log(
      chalk.dim(`  Branch deletion queued: ${result.worktree.branch}`)
    );
  } else if (result.worktree.branch) {
    console.log(chalk.yellow(`Branch kept: ${result.worktree.branch}`));
  } else {
    console.log(chalk.dim("Detached worktree had no branch to delete"));
  }

  emitShellCd(result.relocatedToPath);
}

function logRemovalWarnings(result: {
  warnings: Array<{ message: string }>;
}): void {
  for (const warning of result.warnings) {
    console.error(chalk.yellow(`Warning: ${warning.message}`));
  }
}

async function executeRemovalWithProgress(
  plan: RemovalPlan,
  options: RemoveCommandOptions,
  batchMode: boolean
): Promise<RemovalResult> {
  const execution =
    batchMode || options.foreground ? "foreground" : "auto";
  const shouldShowSpinner =
    execution === "foreground" || !plan.isCurrent || plan.worktree.isMain;

  if (!shouldShowSpinner) {
    return executeRemoval(plan, {
      keepBranch: options.keepBranch,
      execution,
    });
  }

  const branchLabel = getWorktreeBranchLabel(plan.worktree);
  return runWithSpinner(
    `Removing worktree ${branchLabel} (${plan.worktree.id})`,
    () =>
      executeRemoval(plan, {
        keepBranch: options.keepBranch,
        execution,
      })
  );
}

export async function removeSingleWorktree(
  id: string,
  options: RemoveCommandOptions,
  batchMode: boolean,
  prompter: RemovalPrompter
): Promise<"removed" | "skipped"> {
  let plan = await inspectRemoval(id);
  let branchLabel = getWorktreeBranchLabel(plan.worktree);

  if (hasPendingWork(plan) && !options.force) {
    const confirmed = await prompter.confirmRemoval(
      plan.worktree.id,
      branchLabel,
      plan.localChangeCount,
      plan.localCommitCount,
      plan.hasUnknownLocalCommits
    );

    if (!confirmed) {
      if (!batchMode) {
        throw new AppError("Removal cancelled");
      }

      console.log(
        chalk.yellow(
          `Skipped worktree: ${branchLabel} (${plan.worktree.id})`
        )
      );
      return "skipped";
    }
  }

  while (true) {
    const result = await executeRemovalWithProgress(plan, options, batchMode);

    if (result.status === "plan_stale") {
      if (!result.latestPlan) {
        throw new AppError(result.reason);
      }

      plan = result.latestPlan;
      branchLabel = getWorktreeBranchLabel(plan.worktree);

      if (!options.force) {
        const confirmed = await prompter.confirmChangedRemoval(
          plan.worktree.id,
          branchLabel,
          plan.localChangeCount,
          plan.localCommitCount,
          plan.hasUnknownLocalCommits
        );

        if (!confirmed) {
          if (!batchMode) {
            throw new AppError("Removal cancelled");
          }

          console.log(
            chalk.yellow(
              `Skipped worktree: ${branchLabel} (${plan.worktree.id})`
            )
          );
          return "skipped";
        }
      }

      continue;
    }

    if (result.status === "worktree_removed_branch_failed") {
      logRemovalWarnings(result);
      if (result.relocatedToPath) {
        emitShellCd(result.relocatedToPath);
      }
      throw new AppError(result.error);
    }

    if (result.status === "background_started") {
      logBackgroundRemovalResult(result);
    } else {
      logRemovalResult(result);
    }
    logRemovalWarnings(result);

    return "removed";
  }
}
