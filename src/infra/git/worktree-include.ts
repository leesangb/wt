import { $ } from "bun";
import { existsSync } from "fs";
import { join } from "path";

export async function listWorktreeIncludePaths(repoRoot: string) {
  const includePath = join(repoRoot, ".worktreeinclude");
  if (!existsSync(includePath)) {
    return new Set<string>();
  }

  // Evaluate the include file separately so repository ignore rules cannot
  // override its negations. Both lists contain only untracked paths.
  const [matchedOutput, ignoredOutput] = await Promise.all([
    $`git -C ${repoRoot} ls-files --others --ignored --exclude-from=${includePath} -z`.text(),
    $`git -C ${repoRoot} ls-files --others --ignored --exclude-standard -z`.text(),
  ]);
  const ignoredPaths = new Set(ignoredOutput.split("\0").filter(Boolean));

  return new Set(
    matchedOutput.split("\0").filter((path) => ignoredPaths.has(path))
  );
}
