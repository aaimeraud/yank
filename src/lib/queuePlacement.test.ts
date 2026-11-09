import { describe, expect, test } from "bun:test";
import { queuePlacement } from "./queuePlacement";

describe("queuePlacement", () => {
  test("beside the full player", () => {
    expect(queuePlacement(true, "full", true)).toBe("side");
  });

  test("under the mini player", () => {
    expect(queuePlacement(true, "mini", true)).toBe("mini");
  });

  test("closing the player does not leave an empty panel behind", () => {
    expect(queuePlacement(true, "mini", false)).toBe("none");
  });

  test("a closed queue is shown nowhere", () => {
    expect(queuePlacement(false, "full", true)).toBe("none");
  });
});
