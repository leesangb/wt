import chalk from "chalk";
import { isGitRepository, getGitRoot } from "../utils/git.js";
import { settingsExist, saveSettings } from "../config/settings.js";
import type { WtSettings } from "../types/index.js";

export async function initCommand(): Promise<void> {
  if (!(await isGitRepository())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  const repoRoot = await getGitRoot();

  if (await settingsExist(repoRoot)) {
    console.log(chalk.yellow("Warning: .wt/settings.json already exists"));
    return;
  }

  const defaultSettings: WtSettings = {
    worktreeDir: "~/.wt",
    scripts: {
      pre: [],
      post: [],
    },
  };

  await saveSettings(repoRoot, defaultSettings);
  console.log(chalk.green("✓ Initialized wt configuration at .wt/settings.json"));
  console.log(chalk.dim("\nEdit .wt/settings.json to customize:"));
  console.log(chalk.dim("  - worktreeDir: Base directory for worktrees"));
  console.log(chalk.dim("  - scripts.pre: Array of commands to run before creating worktree"));
  console.log(chalk.dim("  - scripts.post: Array of commands to run after creating worktree"));
}
