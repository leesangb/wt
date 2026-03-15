import chalk from "chalk";
import { AppError } from "../app/errors.js";
import { resolveWorktreeCd } from "../app/use-cases/resolve-worktree-cd.js";
import { runCommand } from "../cli/command-runtime.js";
import { emitShellCd } from "../infra/shell/cd.js";

export async function cdCommand(target: string): Promise<void> {
  await runCommand(async () => {
    const result = await resolveWorktreeCd(target);

    if (!result.worktree) {
      console.log(chalk.dim("\nAvailable worktrees:"));
      for (const worktree of result.availableWorktrees) {
        console.log(chalk.cyan(`  ${worktree.id}`) + chalk.dim(` (${worktree.branch})`));
      }
      throw new AppError(`Worktree not found: ${target}`);
    }

    emitShellCd(result.worktree.path);
  });
}
