import { describe, expect, test } from "bun:test";
import { isDrag, nearestCorner, validCorner } from "./miniCorner";

describe("nearestCorner", () => {
  test.each([
    [100, 100, "top-left"],
    [900, 100, "top-right"],
    [100, 700, "bottom-left"],
    [900, 700, "bottom-right"],
  ] as const)("a drop at %i,%i goes to %s", (x, y, corner) => {
    expect(nearestCorner(x, y, 1000, 800)).toBe(corner);
  });

  test("the exact middle resolves to the default corner", () => {
    expect(nearestCorner(500, 400, 1000, 800)).toBe("bottom-right");
  });
});

describe("isDrag", () => {
  test("a press that barely moves is still a click", () => {
    expect(isDrag(2, 3)).toBe(false);
  });

  test("past the threshold in any direction it is a drag", () => {
    expect(isDrag(-5, 0)).toBe(true);
    expect(isDrag(4, -4)).toBe(true);
  });
});

describe("validCorner", () => {
  test("keeps a stored corner", () => {
    expect(validCorner("top-left")).toBe("top-left");
  });

  test("anything else is the default", () => {
    expect(validCorner("middle")).toBe("bottom-right");
    expect(validCorner(null)).toBe("bottom-right");
  });
});
