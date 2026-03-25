import { describe, expect, test } from "bun:test";
import { compareVersions } from "./version.js";

describe("compareVersions", () => {
  test("compares numeric dot-separated versions", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.2.4", "1.2.3")).toBe(1);
    expect(compareVersions("1.2.3", "1.3.0")).toBe(-1);
  });

  test("rejects non-numeric version strings", () => {
    expect(() => compareVersions("foo", "1.2.3")).toThrow(
      "Invalid version format: foo"
    );
    expect(() => compareVersions("1.2.3", "bar")).toThrow(
      "Invalid version format: bar"
    );
  });
});
