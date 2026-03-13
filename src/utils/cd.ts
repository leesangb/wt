export const CD_OUTPUT_PREFIX = "__WT_CD__:";

export function quoteShellPath(path: string): string {
  return `'${path.replace(/'/g, `'"'"'`)}'`;
}

export function buildCdOutput(path: string): string {
  return `${CD_OUTPUT_PREFIX}${path}`;
}

export function parseCdOutput(line: string): string | null {
  if (!line.startsWith(CD_OUTPUT_PREFIX)) {
    return null;
  }

  return line.slice(CD_OUTPUT_PREFIX.length);
}

export function formatCdCommand(path: string): string {
  return `cd ${quoteShellPath(path)}`;
}
