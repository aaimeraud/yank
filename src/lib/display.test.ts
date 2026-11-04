import { describe, expect, test } from "bun:test";
import { displayTitle } from "./display";

describe("displayTitle", () => {
  test("leaves standalone videos alone", () => {
    expect(displayTitle({ title: "Solo", playlist_index: null })).toBe("Solo");
        expect(displayTitle({ title: "Solo", playlist_index: 0 })).toBe("Solo");
  });

  test("pads playlist positions to two digits", () => {
    expect(displayTitle({ title: "Intro", playlist_index: 1 })).toBe("01. Intro");
    expect(displayTitle({ title: "Intro", playlist_index: 9 })).toBe("09. Intro");
    expect(displayTitle({ title: "Intro", playlist_index: 10 })).toBe("10. Intro");
  });

  test("lets a playlist grow past two digits without clipping", () => {
    expect(displayTitle({ title: "Deep cut", playlist_index: 142 })).toBe("142. Deep cut");
  });
});
