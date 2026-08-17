import { describe, expect, test } from "bun:test";
import { buildPullRequestLabel } from "./pull-request-label.js";

describe("buildPullRequestLabel", () => {
  test("removes repeated conventional prefixes and a configured issue key", () => {
    expect(
      buildPullRequestLabel(
        "Sangbin Lee",
        "feat: MIRI-123 refactor(survey)!: survey 도메인 src/v2 이전",
        "[A-Z]+-\\d+"
      )
    ).toBe("Sangbin Lee: survey 도메인 src/v2 이전");
  });

  test("preserves issue keys and conventional words inside the title", () => {
    expect(
      buildPullRequestLabel(
        "Sangbin Lee",
        "Document the feat: behavior for MIRI-123",
        "[A-Z]+-\\d+"
      )
    ).toBe("Sangbin Lee: Document the feat: behavior for MIRI-123");
  });

  test("keeps the original title when trimming would make it empty", () => {
    expect(buildPullRequestLabel("Sangbin Lee", "feat: refactor:")).toBe(
      "Sangbin Lee: feat: refactor:"
    );
  });

  test("ignores an invalid issue pattern", () => {
    expect(buildPullRequestLabel("Sangbin Lee", "MIRI-123: Fix survey", "[")).toBe(
      "Sangbin Lee: MIRI-123: Fix survey"
    );
  });
});
