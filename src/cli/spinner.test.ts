import { describe, expect, test } from "bun:test";
import { runWithSpinner } from "./spinner.js";

class MockStream {
  constructor(readonly isTTY: boolean) {}

  readonly writes: string[] = [];

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return true;
  }
}

describe("runWithSpinner", () => {
  test("does not render anything when the stream is not a TTY", async () => {
    const stream = new MockStream(false);

    await runWithSpinner("Removing worktree feature/test (test123)", async () => {
      await Bun.sleep(5);
    }, {
      stream,
      intervalMs: 1,
    });

    expect(stream.writes).toEqual([]);
  });

  test("renders and clears the spinner for TTY streams", async () => {
    const text = "Removing worktree feature/test (test123)";
    const stream = new MockStream(true);

    await runWithSpinner(text, async () => {
      await Bun.sleep(5);
    }, {
      stream,
      intervalMs: 1,
    });

    expect(stream.writes[0]).toBe(`\r- ${text}`);
    expect(
      stream.writes.some((chunk) => chunk === `\r\\ ${text}`)
    ).toBeTrue();
    expect(stream.writes.at(-1)).toBe(`\r${" ".repeat(text.length + 2)}\r`);
  });

  test("clears the spinner before rethrowing failures", async () => {
    const text = "Removing worktree feature/test (test123)";
    const stream = new MockStream(true);

    await expect(
      runWithSpinner(text, async () => {
        await Bun.sleep(5);
        throw new Error("boom");
      }, {
        stream,
        intervalMs: 1,
      })
    ).rejects.toThrow("boom");

    expect(stream.writes.at(-1)).toBe(`\r${" ".repeat(text.length + 2)}\r`);
  });
});
