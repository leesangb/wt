import { describe, expect, test } from "bun:test";
import { renderHomebrewFormula } from "./homebrew-formula.js";

describe("renderHomebrewFormula", () => {
  test("renders a formula for the current release assets", () => {
    const formula = renderHomebrewFormula({
      version: "0.3.0",
      macosArm64Sha256: "arm64-sha",
      macosX64Sha256: "x64-sha",
    });

    expect(formula).toContain('version "0.3.0"');
    expect(formula).toContain(
      'url "https://github.com/leesangb/wt/releases/download/v0.3.0/wt-macos-arm64"'
    );
    expect(formula).toContain('sha256 "arm64-sha"');
    expect(formula).toContain('sha256 "x64-sha"');
    expect(formula).toContain('brew upgrade wt');
  });
});
