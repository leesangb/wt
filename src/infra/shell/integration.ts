import { existsSync, writeFileSync } from "fs";
import { SHELL_WRAPPER_FILES, SHELL_WRAPPER_PLACEHOLDER } from "./wrapper-contract.js";

export interface UpdateInstalledShellWrappersOptions {
  version: string;
  binaryPath: string;
  shellDir: string;
}

export interface ShellWrapperUpdateResult {
  updatedScripts: string[];
  warnings: string[];
  skipped: boolean;
}

export async function updateInstalledShellWrappers(
  options: UpdateInstalledShellWrappersOptions
): Promise<ShellWrapperUpdateResult> {
  if (!existsSync(options.shellDir)) {
    return {
      updatedScripts: [],
      warnings: [],
      skipped: true,
    };
  }

  const updatedScripts: string[] = [];
  const warnings: string[] = [];

  for (const scriptName of SHELL_WRAPPER_FILES) {
    const scriptPath = `${options.shellDir}/${scriptName}`;

    if (!existsSync(scriptPath)) {
      continue;
    }

    try {
      const url =
        `https://raw.githubusercontent.com/leesangb/wt/v${options.version}/shell/${scriptName}`;
      const response = await fetch(url);

      if (!response.ok) {
        warnings.push(
          `Could not download ${scriptName} (status ${response.status})`
        );
        continue;
      }

      const content = (await response.text()).replace(
        new RegExp(SHELL_WRAPPER_PLACEHOLDER, "g"),
        options.binaryPath
      );

      writeFileSync(scriptPath, content, "utf-8");
      updatedScripts.push(scriptName);
    } catch (error: any) {
      warnings.push(`Failed to update ${scriptName}: ${error.message || error}`);
    }
  }

  return {
    updatedScripts,
    warnings,
    skipped: false,
  };
}
