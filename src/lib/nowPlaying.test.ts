import { describe, expect, test } from "bun:test";
import { makeVideo } from "../test/fixtures";
import { nowPlaying } from "./nowPlaying";

describe("nowPlaying", () => {
  test("shows the title, then the channel and where it comes from", () => {
    const info = nowPlaying(makeVideo("a", { title: "A talk", uploader: "A channel", source: "youtube" }));
    expect(info.title).toBe("A talk");
    expect(info.artist).toBe("A channel");
    expect(info.album).toBe("YouTube");
  });

  test("both halves are always filled, or macOS shows a stray dash", () => {
    const info = nowPlaying(makeVideo("a", { uploader: null, source: "youtube" }));
    expect(info.artist).toBe("Unknown");
    expect(info.album).toBe("YouTube");
  });

  test("a web thumbnail is passed as it is", () => {
    const info = nowPlaying(makeVideo("a", { thumbnail_path: "https://i.ytimg.com/vi/a/hq.jpg" }));
    expect(info.artwork).toEqual([{ src: "https://i.ytimg.com/vi/a/hq.jpg" }]);
  });

  test("no thumbnail, no artwork", () => {
    expect(nowPlaying(makeVideo("a", { thumbnail_path: null })).artwork).toEqual([]);
  });
});
