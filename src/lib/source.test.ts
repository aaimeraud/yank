import { describe, expect, test } from "bun:test";
import { sourceKey, sourceLabel } from "./source";

describe("sourceKey", () => {
  test("maps the extractor names yt-dlp reports", () => {
    expect(sourceKey("youtube")).toBe("youtube");
    expect(sourceKey("youtube:tab")).toBe("youtube");
    expect(sourceKey("Youtube")).toBe("youtube");
    expect(sourceKey("twitter")).toBe("twitter");
    expect(sourceKey("twitch:vod")).toBe("twitch");
    expect(sourceKey("TwitchClips")).toBe("twitch");
    expect(sourceKey("vimeo")).toBe("other");
    expect(sourceKey("generic")).toBe("other");
    expect(sourceKey(null)).toBe("other");
  });
  test("accepts the keys themselves, so filter chips can pass them through", () => {
    for (const key of ["youtube", "twitter", "twitch", "other"] as const) {
      expect(sourceKey(key)).toBe(key);
    }
  });
});

describe("sourceLabel", () => {
  test("brands the main platforms and names the rest", () => {
    expect(sourceLabel("youtube:tab")).toBe("YouTube");
    expect(sourceLabel("twitter")).toBe("X");
    expect(sourceLabel("twitch:vod")).toBe("Twitch");
    expect(sourceLabel("vimeo")).toBe("Vimeo");
    expect(sourceLabel("soundcloud:set")).toBe("Soundcloud");
    expect(sourceLabel("generic")).toBe("Web");
    expect(sourceLabel("")).toBe("Web");
  });
});
