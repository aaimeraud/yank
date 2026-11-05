import { describe, expect, test } from "bun:test";
import { urlBoxFormat } from "./downloadFormats";

describe("urlBoxFormat", () => {
  test("sends nothing until the user picks, so the backend default applies", () => {
    // The bug: the box sent its displayed default, "video" before settings
    // loaded, overriding an "audio" default.
    expect(urlBoxFormat(null, null).send).toBeNull();
    expect(urlBoxFormat(null, "audio").send).toBeNull();
  });
  test("sends the user's pick", () => {
    expect(urlBoxFormat("original", "audio").send).toBe("original");
  });
  test("shows the pick, else the default, else a placeholder until settings load", () => {
    expect(urlBoxFormat("original", "audio").shown).toBe("original");
    expect(urlBoxFormat(null, "audio").shown).toBe("audio");
    expect(urlBoxFormat(null, null).shown).toBe("");
  });
});
