import chalk from "chalk";
import { getWorktreeBranchLabel } from "../domain/worktree.js";
import type { WorktreeInfo, WorktreeState } from "../types/index.js";

type DisplayableWorktree = Pick<
  WorktreeInfo,
  "baseBranch" | "baseCommit" | "branch" | "head" | "id"
> & {
  isCurrent?: boolean;
  isMain?: boolean;
  isMerged?: boolean;
  modifiedCount?: number;
  unpushedCount?: number;
};

function identity(value: string): string {
  return value;
}

function selectColor(
  enabled: boolean,
  formatter: (value: string) => string
): (value: string) => string {
  return enabled ? formatter : identity;
}

export function buildBaseDescription(
  worktree: Pick<WorktreeInfo, "baseBranch" | "baseCommit">
): string | undefined {
  if (worktree.baseBranch && worktree.baseCommit) {
    return `from ${worktree.baseBranch}@${worktree.baseCommit.substring(0, 7)}`;
  }

  if (worktree.baseBranch) {
    return `from ${worktree.baseBranch}`;
  }

  return undefined;
}

export function buildWorktreeIdLabel(
  worktree: Pick<DisplayableWorktree, "id" | "isCurrent" | "isMain">,
  options: { color?: boolean } = {}
): string {
  const color = options.color !== false;
  const blue = selectColor(color, chalk.blue);
  const green = selectColor(color, chalk.green);
  const metadata: string[] = [];

  if (worktree.isMain) {
    metadata.push(blue("[main]"));
  }

  if (worktree.isCurrent) {
    metadata.push(green("(current)"));
  }

  return metadata.length > 0
    ? `${worktree.id} ${metadata.join(" ")}`
    : worktree.id;
}

export function buildWorktreeBranchSummary(
  worktree: DisplayableWorktree,
  options: { color?: boolean } = {}
): string {
  const color = options.color !== false;
  const dim = selectColor(color, chalk.dim);
  const yellow = selectColor(color, chalk.yellow);
  const red = selectColor(color, chalk.red);
  const branchParts = [getWorktreeBranchLabel(worktree)];
  const baseDescription = buildBaseDescription(worktree);
  const indicators: string[] = [];

  if (baseDescription) {
    branchParts.push(dim(baseDescription));
  }

  if (worktree.isMerged) {
    indicators.push(dim("(merged)"));
  }

  if ((worktree.unpushedCount ?? 0) > 0) {
    indicators.push(
      yellow(`↑${worktree.unpushedCount} commits not pushed`)
    );
  }

  if ((worktree.modifiedCount ?? 0) > 0) {
    indicators.push(
      red(`!${worktree.modifiedCount} paths with local changes`)
    );
  }

  if (indicators.length > 0) {
    branchParts.push(indicators.join(" "));
  }

  return branchParts.join(" ");
}

export function pickDisplayState(
  worktree: Pick<DisplayableWorktree, "id">,
  statesById: Map<string, WorktreeState>
): WorktreeState | undefined {
  return statesById.get(worktree.id);
}
