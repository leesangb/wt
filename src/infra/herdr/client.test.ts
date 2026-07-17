import { describe, expect, test } from "bun:test";
import { openHerdrWorktree } from "./client.js";

describe("Herdr client", () => {
  test("does nothing outside a Herdr-managed pane", async () => {
    expect(await openHerdrWorktree("/worktree", "feature", {}, {})).toEqual({
      attempted: false,
      opened: false,
    });
  });
});
