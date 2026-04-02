import chalk from "chalk";

export interface MultiSelectPromptItem<T> {
  details?: string[];
  label: string;
  selected?: boolean;
  value: T;
}

interface LoadedDetailState {
  lines: string[];
  status: "loaded";
}

interface LoadingDetailState {
  status: "loading";
}

interface FailedDetailState {
  message: string;
  status: "error";
}

type DetailState = LoadedDetailState | LoadingDetailState | FailedDetailState;

export interface MultiSelectPromptOptions<T> {
  detailTitle?: string;
  instructions?: string;
  listHeader?: string;
  loadDetails?: (
    item: MultiSelectPromptItem<T>,
    index: number
  ) => Promise<string[]>;
  title: string;
}

export interface MultiSelectPromptResult<T> {
  cancelled: boolean;
  selectedValues: T[];
}

const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;
const WIDE_LAYOUT_MIN_COLUMNS = 140;
const LIST_ITEM_PREFIX_WIDTH = 6;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveVisibleRange(
  itemCount: number,
  currentIndex: number,
  viewportSize: number
): { end: number; start: number } {
  if (itemCount <= viewportSize) {
    return {
      start: 0,
      end: itemCount,
    };
  }

  const half = Math.floor(viewportSize / 2);
  const start = clamp(currentIndex - half, 0, itemCount - viewportSize);

  return {
    start,
    end: start + viewportSize,
  };
}

function buildDivider(): string {
  const width = Math.max(Math.min(process.stdout.columns ?? 80, 100), 20);
  return chalk.dim("─".repeat(width));
}

function buildDividerForWidth(width: number): string {
  return chalk.dim("─".repeat(Math.max(width, 1)));
}

function buildIndentedListHeaderLines(
  listHeader: string | undefined,
  width: number
): string[] {
  if (!listHeader) {
    return [];
  }

  const indent = " ".repeat(LIST_ITEM_PREFIX_WIDTH);
  const visibleWidth = Math.max(width - LIST_ITEM_PREFIX_WIDTH, 1);

  return [
    chalk.bold(`${indent}${listHeader}`),
    chalk.dim(`${indent}${"─".repeat(visibleWidth)}`),
  ];
}

function getVisibleLength(value: string): number {
  return value.replace(ANSI_PATTERN, "").length;
}

function truncateAnsi(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  if (width === 1) {
    return "…";
  }

  let index = 0;
  let visibleLength = 0;
  let result = "";
  const hasAnsi = value.includes("\x1b[");

  while (index < value.length && visibleLength < width - 1) {
    const ansiMatch = value.slice(index).match(/^\x1b\[[0-9;]*m/);

    if (ansiMatch) {
      result += ansiMatch[0];
      index += ansiMatch[0].length;
      continue;
    }

    const codePoint = value.codePointAt(index);

    if (codePoint === undefined) {
      break;
    }

    const char = String.fromCodePoint(codePoint);
    result += char;
    index += char.length;
    visibleLength += 1;
  }

  return hasAnsi ? `${result}…\x1b[0m` : `${result}…`;
}

function formatLineToWidth(value: string, width: number): string {
  if (width <= 0) {
    return "";
  }

  if (getVisibleLength(value) <= width) {
    return value + " ".repeat(width - getVisibleLength(value));
  }

  return truncateAnsi(value, width);
}

function buildDetailLines<T>(
  items: MultiSelectPromptItem<T>[],
  currentIndex: number,
  options: MultiSelectPromptOptions<T>,
  detailStates: Map<number, DetailState>,
  maxDetailLines?: number
): string[] {
  const currentItem = items[currentIndex];
  let detailLines = currentItem?.details ?? [];
  const detailState = detailStates.get(currentIndex);
  const lines = [chalk.bold(options.detailTitle ?? "Current worktree")];

  if (detailState?.status === "loading") {
    detailLines = [chalk.dim("Loading details...")];
  } else if (detailState?.status === "error") {
    detailLines = [
      chalk.red("Failed to load details."),
      chalk.dim(detailState.message),
    ];
  } else if (detailState?.status === "loaded") {
    detailLines = detailState.lines;
  }

  if (detailLines.length === 0) {
    lines.push(chalk.dim("No additional details."));
    return lines;
  }

  if (!maxDetailLines || detailLines.length <= maxDetailLines) {
    lines.push(...detailLines);
    return lines;
  }

  lines.push(...detailLines.slice(0, maxDetailLines));
  lines.push(chalk.dim(`+ ${detailLines.length - maxDetailLines} more lines`));
  return lines;
}

function renderWidePrompt<T>(
  items: MultiSelectPromptItem<T>[],
  selectedIndexes: Set<number>,
  currentIndex: number,
  options: MultiSelectPromptOptions<T>,
  detailStates: Map<number, DetailState>
): void {
  const columns = process.stdout.columns ?? WIDE_LAYOUT_MIN_COLUMNS;
  const rows = process.stdout.rows ?? 24;
  const leftWidth = Math.max(Math.min(Math.floor(columns * 0.52), 72), 44);
  const rightWidth = Math.max(columns - leftWidth - 3, 32);
  const headerLines = [
    chalk.bold(options.title),
    chalk.dim(
      options.instructions ??
        "Use arrow keys or j/k to move, space to toggle, a to select all, n to clear, enter to confirm, q to cancel."
    ),
    chalk.dim(`${selectedIndexes.size} selected of ${items.length}`),
    "",
  ];
  const contentRows = Math.max(rows - headerLines.length, 8);
  const listHeaderLines = buildIndentedListHeaderLines(
    options.listHeader,
    leftWidth
  );
  const viewportRows = Math.max(contentRows - listHeaderLines.length, 5);
  const needsRange = items.length > viewportRows;
  const listViewportSize = Math.max(viewportRows - (needsRange ? 1 : 0), 5);
  const { start, end } = resolveVisibleRange(
    items.length,
    currentIndex,
    listViewportSize
  );
  const listLines = items.slice(start, end).map((item, offset) => {
    const index = start + offset;
    const cursor = index === currentIndex ? chalk.cyan("›") : " ";
    const checkbox = selectedIndexes.has(index)
      ? chalk.green("[x]")
      : chalk.dim("[ ]");

    return `${cursor} ${checkbox} ${item.label}`;
  });

  if (needsRange) {
    listLines.push(chalk.dim(`Showing ${start + 1}-${end} of ${items.length}`));
  }

  const leftLines = [...listHeaderLines, ...listLines];

  const rightLines = buildDetailLines(
    items,
    currentIndex,
    options,
    detailStates,
    Math.max(contentRows - 2, 4)
  );
  const outputLines = [...headerLines];
  const lineCount = Math.max(leftLines.length, rightLines.length);

  for (let index = 0; index < lineCount; index += 1) {
    outputLines.push(
      `${formatLineToWidth(leftLines[index] ?? "", leftWidth)} ${chalk.dim("│")} ${formatLineToWidth(rightLines[index] ?? "", rightWidth)}`
    );
  }

  process.stdout.write(`\x1b[?25l\x1b[2J\x1b[H${outputLines.join("\n")}`);
}

function renderPrompt<T>(
  items: MultiSelectPromptItem<T>[],
  selectedIndexes: Set<number>,
  currentIndex: number,
  options: MultiSelectPromptOptions<T>,
  detailStates: Map<number, DetailState>
): void {
  if ((process.stdout.columns ?? 0) >= WIDE_LAYOUT_MIN_COLUMNS) {
    renderWidePrompt(
      items,
      selectedIndexes,
      currentIndex,
      options,
      detailStates
    );
    return;
  }

  const detailLines = buildDetailLines(
    items,
    currentIndex,
    options,
    detailStates,
    7
  );
  const detailSectionLines = 1 + detailLines.length;
  const listHeaderLines = buildIndentedListHeaderLines(
    options.listHeader,
    Math.max(Math.min(process.stdout.columns ?? 80, 100), 20)
  );
  const viewportSize = Math.max(
    (process.stdout.rows ?? 24) - 4 - detailSectionLines - listHeaderLines.length,
    5
  );
  const { start, end } = resolveVisibleRange(
    items.length,
    currentIndex,
    viewportSize
  );
  const visibleItems = items.slice(start, end);
  const lines = [
    chalk.bold(options.title),
    chalk.dim(
      options.instructions ??
        "Use arrow keys or j/k to move, space to toggle, a to select all, n to clear, enter to confirm, q to cancel."
    ),
    chalk.dim(`${selectedIndexes.size} selected of ${items.length}`),
    "",
  ];

  lines.push(...listHeaderLines);

  for (const [offset, item] of visibleItems.entries()) {
    const index = start + offset;
    const cursor = index === currentIndex ? chalk.cyan("›") : " ";
    const checkbox = selectedIndexes.has(index)
      ? chalk.green("[x]")
      : chalk.dim("[ ]");

    lines.push(`${cursor} ${checkbox} ${item.label}`);
  }

  if (start > 0 || end < items.length) {
    lines.push("");
    lines.push(chalk.dim(`Showing ${start + 1}-${end} of ${items.length}`));
  }

  lines.push("");
  lines.push(buildDivider());
  lines.push(...detailLines);

  process.stdout.write(`\x1b[?25l\x1b[2J\x1b[H${lines.join("\n")}`);
}

function toggleAll(selectedIndexes: Set<number>, itemCount: number): Set<number> {
  if (selectedIndexes.size === itemCount) {
    return new Set<number>();
  }

  return new Set(Array.from({ length: itemCount }, (_, index) => index));
}

function finalizePrompt<T>(
  items: MultiSelectPromptItem<T>[],
  selectedIndexes: Set<number>,
  cancelled: boolean
): MultiSelectPromptResult<T> {
  return {
    cancelled,
    selectedValues: Array.from(selectedIndexes)
      .sort((a, b) => a - b)
      .map((index) => items[index]?.value)
      .filter((value): value is T => value !== undefined),
  };
}

export async function promptMultiSelect<T>(
  items: MultiSelectPromptItem<T>[],
  options: MultiSelectPromptOptions<T>
): Promise<MultiSelectPromptResult<T>> {
  if (items.length === 0) {
    return {
      cancelled: false,
      selectedValues: [],
    };
  }

  return new Promise<MultiSelectPromptResult<T>>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw === true;
    const useAlternateScreen = process.stdout.isTTY === true;
    const detailLoadPromises = new Map<number, Promise<void>>();
    const detailStates = new Map<number, DetailState>(
      items.flatMap((item, index) =>
        item.details
          ? [[index, { lines: item.details, status: "loaded" } satisfies DetailState]]
          : []
      )
    );
    let isActive = true;
    let currentIndex = 0;
    let selectedIndexes = new Set<number>(
      items.flatMap((item, index) => (item.selected ? [index] : []))
    );

    const rerender = () => {
      if (!isActive) {
        return;
      }

      renderPrompt(items, selectedIndexes, currentIndex, options, detailStates);
    };

    const ensureDetailsLoaded = (index: number) => {
      if (!options.loadDetails) {
        return;
      }

      if (detailStates.has(index) || detailLoadPromises.has(index)) {
        return;
      }

      const item = items[index];

      if (!item) {
        return;
      }

      detailStates.set(index, { status: "loading" });
      const loadPromise = options
        .loadDetails(item, index)
        .then((lines) => {
          detailStates.set(index, {
            lines,
            status: "loaded",
          });
        })
        .catch((error) => {
          detailStates.set(index, {
            message: error instanceof Error ? error.message : String(error),
            status: "error",
          });
        })
        .finally(() => {
          detailLoadPromises.delete(index);
          rerender();
        });

      detailLoadPromises.set(index, loadPromise);
    };

    const cleanup = (result: MultiSelectPromptResult<T>) => {
      isActive = false;
      stdin.off("data", handleData);
      stdin.setRawMode?.(wasRaw);
      if (!wasRaw) {
        stdin.pause();
      }

      process.stdout.write(
        useAlternateScreen ? "\x1b[?25h\x1b[?1049l" : "\x1b[?25h\x1b[2J\x1b[H"
      );
      resolve(result);
    };

    const handleData = (chunk: Buffer | string) => {
      const value = chunk.toString();

      switch (value) {
        case "\u0003":
        case "q":
        case "\u001b":
          cleanup(finalizePrompt(items, selectedIndexes, true));
          return;
        case "\r":
        case "\n":
          cleanup(finalizePrompt(items, selectedIndexes, false));
          return;
        case " ":
          if (selectedIndexes.has(currentIndex)) {
            selectedIndexes.delete(currentIndex);
          } else {
            selectedIndexes.add(currentIndex);
          }
          break;
        case "a":
          selectedIndexes = toggleAll(selectedIndexes, items.length);
          break;
        case "n":
          selectedIndexes = new Set<number>();
          break;
        case "\u001b[A":
        case "k":
          currentIndex = currentIndex === 0 ? items.length - 1 : currentIndex - 1;
          break;
        case "\u001b[B":
        case "j":
          currentIndex = currentIndex === items.length - 1 ? 0 : currentIndex + 1;
          break;
        default:
          break;
      }

      ensureDetailsLoaded(currentIndex);
      rerender();
    };

    if (useAlternateScreen) {
      process.stdout.write("\x1b[?1049h");
    }

    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.on("data", handleData);
    ensureDetailsLoaded(currentIndex);
    rerender();
  });
}
