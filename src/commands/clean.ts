import chalk from "chalk";
import { AppError } from "../app/errors.js";
import { isPathInside } from "../domain/path.js";
import { getWorktreeBranchLabel } from "../domain/worktree.js";
import {
  type CleanWorktreeCandidate,
  planWorktreeCleanup,
} from "../app/use-cases/clean-worktrees.js";
import {
  inspectRemoval,
  type RemovalPlan,
} from "../app/use-cases/remove-worktree.js";
import { promptMultiSelect } from "../cli/multi-select.js";
import { runCommand } from "../cli/command-runtime.js";
import {
  buildPendingWorkSummary,
  createRemovalPrompter,
  type RemoveCommandOptions,
  removeSingleWorktree,
} from "./remove-shared.js";
import {
  buildBaseDescription,
  buildWorktreeBranchSummary,
  buildWorktreeIdLabel,
} from "./worktree-display.js";

interface CleanCommandOptions extends RemoveCommandOptions {
  dry?: boolean;
  dryRun?: boolean;
  interactive?: boolean;
  merged?: boolean;
  remoteDeleted?: boolean;
}

interface CleanupPickerEntry {
  candidate: CleanWorktreeCandidate;
  isCurrent: boolean;
}

interface CleanupPreviewEntry extends CleanupPickerEntry {
  preview: RemovalPlan;
}

const WIDE_LAYOUT_MIN_COLUMNS = 140;
const PICKER_ID_COLUMN_WIDTH = 18;
const PICKER_BRANCH_COLUMN_WIDTH = 22;

function formatBadge(
  label: string,
  color:
    | "blue"
    | "cyan"
    | "dim"
    | "green"
    | "red"
    | "yellow"
    | "yellowBright"
): string {
  const value = `[${label}]`;

  switch (color) {
    case "blue":
      return chalk.blue(value);
    case "cyan":
      return chalk.cyan(value);
    case "dim":
      return chalk.dim(value);
    case "green":
      return chalk.green(value);
    case "red":
      return chalk.red(value);
    case "yellow":
      return chalk.yellow(value);
    case "yellowBright":
      return chalk.yellowBright(value);
  }
}

function isDryRun(options: CleanCommandOptions): boolean {
  return options.dry === true || options.dryRun === true;
}

function assertInteractiveTerminal(): void {
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    typeof process.stdin.setRawMode !== "function"
  ) {
    throw new AppError("wt clean requires an interactive terminal.");
  }
}

function formatReason(reason: CleanWorktreeCandidate["reasons"][number]): string {
  switch (reason) {
    case "merged":
      return "merged";
    case "remote_deleted":
      return "remote deleted";
  }
}

function buildReasonDescription(candidate: CleanWorktreeCandidate): string {
  if (candidate.reasons.length === 0) {
    return "none";
  }

  return candidate.reasons.map((reason) => formatReason(reason)).join(", ");
}

function buildPickerBadges(entry: CleanupPickerEntry): string[] {
  const badges: string[] = [];

  if (entry.isCurrent) {
    badges.push(formatBadge("current", "green"));
  }

  for (const reason of entry.candidate.reasons) {
    if (reason === "merged") {
      badges.push(formatBadge("merged", "dim"));
    }

    if (reason === "remote_deleted") {
      badges.push(formatBadge("remote deleted", "yellow"));
    }
  }

  return badges;
}

function formatPickerColumn(value: string, width: number): string {
  if (value.length >= width) {
    if (width <= 1) {
      return value.slice(0, width);
    }

    return `${value.slice(0, width - 1)}…`;
  }

  return value.padEnd(width);
}

function buildPickerListHeader(): string {
  return [
    formatPickerColumn("ID", PICKER_ID_COLUMN_WIDTH),
    formatPickerColumn("Branch", PICKER_BRANCH_COLUMN_WIDTH),
    "Flags",
  ].join("  ");
}

function buildPickerLabel(entry: CleanupPickerEntry): string {
  const badges = buildPickerBadges(entry);
  const idLabel = chalk.cyan(
    formatPickerColumn(entry.candidate.worktree.id, PICKER_ID_COLUMN_WIDTH)
  );
  const branchLabel = chalk.white(
    formatPickerColumn(
      getWorktreeBranchLabel(entry.candidate.worktree),
      PICKER_BRANCH_COLUMN_WIDTH
    )
  );

  return badges.length > 0
    ? `${idLabel}  ${branchLabel}  ${badges.join(" ")}`
    : `${idLabel}  ${branchLabel}`;
}

function buildPickerDetails(
  entry: CleanupPickerEntry,
  preview: RemovalPlan
): string[] {
  const idDisplay = buildWorktreeIdLabel({
    id: entry.candidate.worktree.id,
    isCurrent: entry.isCurrent,
    isMain: entry.candidate.worktree.isMain,
  });
  const baseDescription = buildBaseDescription(entry.candidate.worktree) ?? "-";
  const createdAt = new Date(entry.candidate.worktree.createdAt).toLocaleString();
  const pendingDescription =
    preview.localChangeCount > 0 ||
    preview.localCommitCount > 0 ||
    preview.hasUnknownLocalCommits
      ? buildPendingWorkSummary(
          preview.localChangeCount,
          preview.localCommitCount,
          preview.hasUnknownLocalCommits
        )
      : "none";
  const gitStatusLines =
    preview.statusEntries && preview.statusEntries.length > 0
      ? [
          "git status:",
          ...preview.statusEntries.map((line) => `  ${line}`),
          ...(preview.remainingStatusEntryCount
            ? [
                chalk.dim(
                  `  ... +${preview.remainingStatusEntryCount} more status entries`
                ),
              ]
            : []),
        ]
      : preview.localChangeCount > 0
      ? [
          `git status: ${preview.localChangeCount} ${
            preview.localChangeCount === 1 ? "path" : "paths"
          } with local changes`,
        ]
      : ["git status: clean"];
  const matchedDescription = buildReasonDescription(entry.candidate);

  return [
    chalk.cyan(`ID:      ${idDisplay}`),
    chalk.white(`Branch:  ${getWorktreeBranchLabel(entry.candidate.worktree)}`),
    chalk.dim(`Path:    ${entry.candidate.worktree.path}`),
    chalk.dim(`Created: ${createdAt}`),
    chalk.dim(`Base:    ${baseDescription}`),
    chalk.dim(`Matched: ${matchedDescription}`),
    pendingDescription === "none"
      ? chalk.dim("Pending: none")
      : chalk.yellow(`Pending: ${pendingDescription}`),
    ...gitStatusLines,
  ];
}

function buildCleanupPickerEntries(
  candidates: CleanWorktreeCandidate[],
  cwd: string = process.cwd()
): CleanupPickerEntry[] {
  return candidates
    .map((candidate) => ({
      candidate,
      isCurrent: isPathInside(candidate.worktree.path, cwd),
    }))
    .sort(
      (left, right) => Number(right.isCurrent) - Number(left.isCurrent)
    );
}

function canUseCachedPreview(
  preview: RemovalPlan,
  includeStatusEntries: boolean
): boolean {
  if (!includeStatusEntries) {
    return true;
  }

  return preview.statusEntries !== undefined || preview.localChangeCount === 0;
}

async function loadCachedPreview(
  entry: CleanupPickerEntry,
  previewCache: Map<string, RemovalPlan>,
  options: {
    includeStatusEntries?: boolean;
  } = {}
): Promise<RemovalPlan> {
  const includeStatusEntries = options.includeStatusEntries === true;
  const cachedPreview = previewCache.get(entry.candidate.worktree.id);

  if (cachedPreview && canUseCachedPreview(cachedPreview, includeStatusEntries)) {
    return cachedPreview;
  }

  const preview = await inspectRemoval(entry.candidate.worktree.id, process.cwd(), {
    includeStatusEntries,
  });
  previewCache.set(entry.candidate.worktree.id, preview);
  return preview;
}

async function attachCleanupPreviews(
  entries: CleanupPickerEntry[],
  previewCache: Map<string, RemovalPlan>
): Promise<CleanupPreviewEntry[]> {
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      preview: await loadCachedPreview(entry, previewCache),
    }))
  );
}

function renderCleanupPreview(
  repoName: string,
  entries: CleanupPreviewEntry[]
): void {
  console.log(chalk.bold(`\nCleanup candidates (${repoName}):`));
  console.log(chalk.dim("─".repeat(80)));

  for (const entry of entries) {
    const idDisplay = buildWorktreeIdLabel({
      id: entry.candidate.worktree.id,
      isCurrent: entry.isCurrent,
      isMain: entry.candidate.worktree.isMain,
    });

    console.log(chalk.cyan(`ID:      ${idDisplay}`));
    console.log(
      chalk.white(
        `Branch:  ${buildWorktreeBranchSummary(entry.candidate.worktree)}`
      )
    );
    console.log(chalk.dim(`Why:     ${buildReasonDescription(entry.candidate)}`));

    if (
      entry.preview.localChangeCount > 0 ||
      entry.preview.localCommitCount > 0 ||
      entry.preview.hasUnknownLocalCommits
    ) {
      console.log(
        chalk.yellow(
          `Pending: ${buildPendingWorkSummary(
            entry.preview.localChangeCount,
            entry.preview.localCommitCount,
            entry.preview.hasUnknownLocalCommits
          )}`
        )
      );
    } else {
      console.log(chalk.dim("Pending: none"));
    }

    console.log(chalk.dim(`Path:    ${entry.candidate.worktree.path}`));
    console.log(chalk.dim("─".repeat(80)));
  }
}

async function selectCleanupEntries(
  repoName: string,
  entries: CleanupPickerEntry[],
  previewCache: Map<string, RemovalPlan>
): Promise<CleanupPickerEntry[] | undefined> {
  const result = await promptMultiSelect(
    entries.map((entry) => ({
      label: buildPickerLabel(entry),
      selected: entry.candidate.reasons.length > 0,
      value: entry,
    })),
    {
      listHeader: buildPickerListHeader(),
      title: `Select worktrees to clean (${repoName})`,
      instructions:
        "Use arrow keys or j/k to move, space to toggle, a to select all, n to clear, enter to confirm, q to cancel.",
      loadDetails: async (item) =>
        buildPickerDetails(
          item.value,
          await loadCachedPreview(item.value, previewCache, {
            includeStatusEntries:
              (process.stdout.columns ?? 0) >= WIDE_LAYOUT_MIN_COLUMNS,
          })
        ),
    }
  );

  if (result.cancelled) {
    return undefined;
  }

  return result.selectedValues;
}

export async function cleanCommand(
  options: CleanCommandOptions
): Promise<void> {
  await runCommand(async () => {
    const previewCache = new Map<string, RemovalPlan>();
    assertInteractiveTerminal();

    const plan = await planWorktreeCleanup(
      {
        merged: options.merged,
        remoteDeleted: options.remoteDeleted,
      },
      process.cwd(),
      {
        includeAllCandidates: true,
      }
    );

    if (plan.candidates.length === 0) {
      console.log(chalk.yellow("No worktrees available to clean."));
      return;
    }

    const pickerEntries = buildCleanupPickerEntries(plan.candidates);
    const selectedEntries = await selectCleanupEntries(
      plan.repoName,
      pickerEntries,
      previewCache
    );

    if (!selectedEntries) {
      console.log(chalk.yellow("Cleanup cancelled."));
      return;
    }

    if (selectedEntries.length === 0) {
      console.log(chalk.yellow("No worktrees selected."));
      return;
    }

    const previewEntries = await attachCleanupPreviews(
      selectedEntries,
      previewCache
    );

    renderCleanupPreview(plan.repoName, previewEntries);

    if (isDryRun(options)) {
      console.log(chalk.dim("Dry run only. No worktrees were removed."));
      return;
    }

    const prompter = createRemovalPrompter();

    try {
      if (!options.force) {
        console.log("");
        const confirmed = await prompter.confirmCleanup(previewEntries.length);

        if (!confirmed) {
          console.log(chalk.yellow("Cleanup cancelled."));
          return;
        }
      }

      let hadSkippedOrFailedTargets = false;

      for (const [index, entry] of previewEntries.entries()) {
        if (index > 0) {
          console.log("");
        }

        try {
          const result = await removeSingleWorktree(
            entry.candidate.worktree.id,
            options,
            true,
            prompter
          );

          if (result === "skipped") {
            hadSkippedOrFailedTargets = true;
          }
        } catch (error) {
          hadSkippedOrFailedTargets = true;
          const message = error instanceof Error ? error.message : String(error);
          console.error(
            chalk.red(`Error removing "${entry.candidate.worktree.id}": ${message}`)
          );
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
