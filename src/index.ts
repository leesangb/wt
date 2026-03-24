#!/usr/bin/env node

import { Command, Option } from "commander";
import { initCommand } from "./commands/init.js";
import { newCommand } from "./commands/new.js";
import { listCommand } from "./commands/list.js";
import { removeCommand } from "./commands/remove.js";
import { cdCommand } from "./commands/cd.js";
import { updateCommand } from "./commands/update.js";
import { prCommand } from "./commands/pr.js";
import { checkoutCommand } from "./commands/checkout.js";
import pkg from "../package.json";

const program = new Command();

program
  .name("wt")
  .description("Git worktree manager CLI")
  .version(pkg.version);

program
  .command("init")
  .description("Initialize wt configuration in current repository")
  .action(initCommand);

program
  .command("new <branch-name>")
  .description("Create a new worktree")
  .option("-b, --base <base-branch>", "Base branch to create from")
  .option("--id <id>", "Custom ID for the worktree (default: branch name)")
  .option("--no-push", "Skip pushing the new branch to remote")
  .option("--no-cd", "Skip changing directory (for direct binary usage)")
  .action(newCommand);

program
  .command("list")
  .alias("ls")
  .description("List all worktrees")
  .option("--completion <format>", "Output completion format (bash, zsh, fish)")
  .addOption(new Option("--exclude-main-worktree").hideHelp())
  .action(listCommand);

program
  .command("remove <ids...>")
  .alias("rm")
  .description("Remove one or more worktrees by ID")
  .option("--keep-branch", "Keep the branch after removing worktree")
  .option("-f, --force", "Skip confirmation for worktrees with pending changes")
  .action(removeCommand);

program
  .command("cd <target>")
  .description("Change directory to a worktree by ID or branch name")
  .action(cdCommand);

program
  .command("pr <number>")
  .description("Create or navigate to a pull request worktree")
  .option("--no-cd", "Skip changing directory (for direct binary usage)")
  .action(prCommand);

program
  .command("checkout <branch-name>")
  .alias("switch")
  .description("Create or navigate to a local branch worktree")
  .option("--no-cd", "Skip changing directory (for direct binary usage)")
  .action(checkoutCommand);

program
  .command("update")
  .description("Update wt to the latest (or specified) released version")
  .option("-v, --version <version>", "Specific version to install (e.g. 0.3.1)")
  .option("-f, --force", "Force re-download even if version is not newer")
  .option(
    "--no-remove-quarantine",
    "Do not remove macOS quarantine attribute after download"
  )
  .action(updateCommand);

await program.parseAsync();
