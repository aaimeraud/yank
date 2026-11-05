import { describe, expect, test } from "bun:test";
import { patchPlayback, playbackSnapshot } from "./playback";
import { makeVideo } from "../test/fixtures";

describe("playbackSnapshot", () => {
  test("marks a video watched from 90% on", () => {
    expect(playbackSnapshot(89, 100).watched).toBe(false);
    expect(playbackSnapshot(90, 100).watched).toBe(true);
    expect(playbackSnapshot(100, 100).watched).toBe(true);
  });

  test("uses the duration it is handed", () => {
    // The call site must pass the duration captured while this video played.
    // Passing the next video's duration is what marked a finished video
    // unwatched, so this pins the arithmetic the fix relies on.
    expect(playbackSnapshot(3, 3).watched).toBe(true);
    expect(playbackSnapshot(3, 1800).watched).toBe(false);
  });

  test("floors the position and survives a missing duration", () => {
    expect(playbackSnapshot(12.9, 100)).toEqual({ position: 12, watched: false });
    expect(playbackSnapshot(12.9, 0).watched).toBe(false);
    expect(playbackSnapshot(-4, 100)).toEqual({ position: 0, watched: false });
  });
});

describe("patchPlayback", () => {
  test("a replay never takes the watched mark away", () => {
    const watched = makeVideo("v", { watched: true, last_position: 95 });
    expect(patchPlayback(watched, 5, false)).toEqual({ ...watched, last_position: 5, watched: true });
  });
  test("reaching 90% marks it", () => {
    expect(patchPlayback(makeVideo("v"), 91, true).watched).toBe(true);
  });
  test("returns the same object when nothing changes", () => {
    const video = makeVideo("v", { watched: true, last_position: 40 });
    expect(patchPlayback(video, 40, false)).toBe(video);
  });
});
