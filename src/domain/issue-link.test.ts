import { describe, expect, test } from "bun:test";
import { buildIssueLink } from "./issue-link.js";

describe("buildIssueLink", () => {
  test("builds an issue URL from a branch name using the full match", () => {
    expect(
      buildIssueLink("feature/DEV-123", {
        pattern: "[A-Z]+-\\d+",
        url: "https://myissues.com/$issue",
      })
    ).toEqual({
      key: "DEV-123",
      url: "https://myissues.com/DEV-123",
    });
  });

  test("uses the first capture group as the issue key", () => {
    expect(
      buildIssueLink("feature/DEV-123-extra", {
        pattern: "feature/([A-Z]+-\\d+)",
        url: "https://myissues.com/browse/$issue",
      })
    ).toEqual({
      key: "DEV-123",
      url: "https://myissues.com/browse/DEV-123",
    });
  });

  test("returns undefined when the branch does not match the issue pattern", () => {
    expect(
      buildIssueLink("feature/no-ticket", {
        pattern: "[A-Z]+-\\d+",
        url: "https://myissues.com/$issue",
      })
    ).toBeUndefined();
  });
});
