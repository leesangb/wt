import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { WorktreeMeta } from "../../domain/worktree.js";

export const WORKTREE_DIRNAME = ".wt";
export const WORKTREE_META_FILENAME = "meta.json";
export const LEGACY_WORKTREE_META_FILENAME = "meta";
export const WORKTREE_GITIGNORE_CONTENT = ".gitignore\n*\n";

export async function readWorktreeMeta(
  worktreePath: string
): Promise<WorktreeMeta | undefined> {
  const preferredPath = join(
    worktreePath,
    WORKTREE_DIRNAME,
    WORKTREE_META_FILENAME
  );
  const legacyPath = join(
    worktreePath,
    WORKTREE_DIRNAME,
    LEGACY_WORKTREE_META_FILENAME
  );
  const metaPath = existsSync(preferredPath)
    ? preferredPath
    : existsSync(legacyPath)
    ? legacyPath
    : undefined;

  if (!metaPath) {
    return undefined;
  }

  try {
    return JSON.parse(readFileSync(metaPath, "utf-8")) as WorktreeMeta;
  } catch {
    return undefined;
  }
}

export async function writeWorktreeMeta(
  worktreePath: string,
  meta: WorktreeMeta
): Promise<void> {
  const wtDir = join(worktreePath, WORKTREE_DIRNAME);

  if (!existsSync(wtDir)) {
    mkdirSync(wtDir, { recursive: true });
  }

  writeFileSync(
    join(wtDir, WORKTREE_META_FILENAME),
    JSON.stringify(meta, null, 2)
  );
  writeFileSync(join(wtDir, ".gitignore"), WORKTREE_GITIGNORE_CONTENT);
}
