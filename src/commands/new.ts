import chalk from "chalk";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { isGitRepository, getGitRoot, getRepoName, createWorktree } from "../utils/git.js";
import { loadSettings, expandPath } from "../config/settings.js";
import { generateShortId } from "../utils/id.js";
import { executeScripts } from "../utils/script.js";

interface NewCommandOptions {
  base?: string;
}

export async function newCommand(branchName: string, options: NewCommandOptions): Promise<void> {
  if (!(await isGitRepository())) {
    console.error(chalk.red("Error: Not a git repository"));
    process.exit(1);
  }

  const repoRoot = await getGitRoot();
  const repoName = await getRepoName();
  const settings = await loadSettings(repoRoot);
  
  const shortId = generateShortId();
  const dirName = `${repoName}-${shortId}`;
  const worktreeBaseDir = expandPath(settings.worktreeDir);
  const worktreePath = join(worktreeBaseDir, dirName);

  if (!existsSync(worktreeBaseDir)) {
    mkdirSync(worktreeBaseDir, { recursive: true });
  }

  try {
    if (settings.scripts?.pre && settings.scripts.pre.length > 0) {
      console.log(chalk.blue("Running pre scripts..."));
      await executeScripts(settings.scripts.pre, repoRoot, {
        WT_PATH: worktreePath,
        WT_ID: shortId,
        WT_BRANCH: branchName,
      });
    }

    console.log(chalk.blue(`Creating worktree at ${worktreePath}...`));
    await createWorktree(worktreePath, branchName, options.base);
    console.log(chalk.green(`✓ Created worktree: ${branchName}`));

    if (settings.scripts?.post && settings.scripts.post.length > 0) {
      console.log(chalk.blue("Running post scripts..."));
      await executeScripts(settings.scripts.post, worktreePath, {
        WT_PATH: worktreePath,
        WT_ID: shortId,
        WT_BRANCH: branchName,
      });
    }

    console.log(chalk.green(`\n✓ Worktree created successfully!`));
    console.log(chalk.dim(`  ID: ${shortId}`));
    console.log(chalk.dim(`  Path: ${worktreePath}`));
    console.log(chalk.dim(`  Branch: ${branchName}`));
    console.log(chalk.cyan(`\nTo navigate to the worktree, run:`));
    console.log(chalk.cyan(`  cd ${worktreePath}`));

  } catch (error) {
    console.error(chalk.red(`Error creating worktree: ${error}`));
    process.exit(1);
  }
}
