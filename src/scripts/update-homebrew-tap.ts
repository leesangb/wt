import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { renderHomebrewFormula } from "../infra/update/homebrew-formula.js";

function getRequiredEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const tapRepoPath = process.argv[2];

if (!tapRepoPath) {
  throw new Error(
    "Usage: bun run src/scripts/update-homebrew-tap.ts <tap-repository-path>"
  );
}

const formulaPath = join(tapRepoPath, "Formula", "wt.rb");
const formula = renderHomebrewFormula({
  version: getRequiredEnv("WT_VERSION"),
  macosArm64Sha256: getRequiredEnv("WT_MACOS_ARM64_SHA256"),
  macosX64Sha256: getRequiredEnv("WT_MACOS_X64_SHA256"),
});

mkdirSync(dirname(formulaPath), { recursive: true });
writeFileSync(formulaPath, formula, "utf-8");

console.log(`Updated ${formulaPath}`);
