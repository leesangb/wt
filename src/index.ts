#!/usr/bin/env node

import { Command } from "commander";
import { initCommand } from "./commands/init.js";
import { newCommand } from "./commands/new.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { cdCommand } from "./commands/cd.js";
import { isGitRepository, getGitRoot } from "./utils/git.js";
import pkg from "../package.json";

const program = new Command();

program
  .name("wt")
  .description("Git worktree manager CLI")
  .version(pkg.version)
  .hook('preAction', async () => {
    if (await isGitRepository()) {
      const repoRoot = await getGitRoot();
      process.chdir(repoRoot);
    }
  });

program
  .command("init")
  .description("Initialize wt configuration in current repository")
  .action(initCommand);

program
  .command("new <branch-name>")
  .description("Create a new worktree")
  .option("-b, --base <base-branch>", "Base branch to create from")
  .option("--no-push", "Skip pushing the new branch to remote")
  .option("--no-cd", "Skip changing directory (for direct binary usage)")
  .action(newCommand);

program
  .command("list")
  .alias("ls")
  .description("List all worktrees")
  .action(listCommand);

program
  .command("remove <id>")
  .alias("rm")
  .description("Remove a worktree by ID")
  .option("--keep-branch", "Keep the branch after removing worktree")
  .action(removeCommand);

program
  .command("cd <target>")
  .description("Change directory to a worktree by ID or branch name")
  .action(cdCommand);

program.parse();
