import { describe, expect, test } from "bun:test";
import type { Video } from "../types";
import {
  enqueueId,
  nextAfter,
  nextInContext,
  playNextId,
  takeNextPlayable,
} from "./playQueue";

const video = (id: string, overrides: Partial<Video> = {}): Video => ({
  id,
  title: `Video ${id}`,
  uploader: null,
  duration: null,
  thumbnail_path: null,
  source: "Youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  file_path: `/tmp/${id}.mp4`,
  watched: false,
  last_position: 0,
  folder_id: null,
  ...overrides,
});

describe("nextInContext", () => {
  test("returns the next playable video in visible order", () => {
    const list = [video("a"), video("b"), video("c")];
    expect(nextInContext(list, "a")?.id).toBe("b");
    expect(nextInContext(list, "b")?.id).toBe("c");
  });

  test("stops at the end instead of wrapping", () => {
    expect(nextInContext([video("a"), video("b")], "b")).toBeNull();
  });

  test("skips rows without a file and an unknown current id", () => {
    const list = [video("a"), video("b", { file_path: null }), video("c")];
    expect(nextInContext(list, "a")?.id).toBe("c");
    expect(nextInContext(list, "missing")).toBeNull();
  });
});

describe("nextAfter", () => {
  test("stays inside the visible folder and stops at its last video", () => {
    const all = [video("a"), video("b"), video("c")];
    const folder = [video("a"), video("b")];
    expect(nextAfter(video("a"), folder, all)?.id).toBe("b");
    expect(nextAfter(video("b"), folder, all)).toBeNull();
  });

  test("falls back to the library only when the current video is not visible", () => {
    const all = [video("a"), video("b"), video("c")];
    const folder = [video("a"), video("b")];
    expect(nextAfter(video("a"), [video("x"), video("y")], all)?.id).toBe("b");
    expect(nextAfter(video("c"), folder, all)).toBeNull();
    expect(nextAfter(video("b"), all, all)?.id).toBe("c");
  });
});

describe("enqueueId", () => {
  test("appends once and keeps the original order", () => {
    expect(enqueueId(["a"], "b")).toEqual(["a", "b"]);
    expect(enqueueId(["a", "b"], "a")).toEqual(["a", "b"]);
  });
});

describe("playNextId", () => {
  test("moves an id to the front and removes its old spot", () => {
    expect(playNextId(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(playNextId(["a"], "b")).toEqual(["b", "a"]);
  });
});

describe("takeNextPlayable", () => {
  test("takes the first playable entry and leaves the rest", () => {
    const list = [video("a"), video("b"), video("c")];
    const { video: next, rest } = takeNextPlayable(["b", "c"], list, "a");
    expect(next?.id).toBe("b");
    expect(rest).toEqual(["c"]);
  });

  test("skips the current video and entries whose file is gone", () => {
    const list = [video("a"), video("b", { file_path: null }), video("c")];
    const { video: next, rest } = takeNextPlayable(["a", "b", "c"], list, "a");
    expect(next?.id).toBe("c");
    expect(rest).toEqual([]);
  });

  test("drains the queue when nothing is playable", () => {
    const list = [video("a", { file_path: null })];
    expect(takeNextPlayable(["a"], list, "b")).toEqual({ video: null, rest: [] });
  });

  test("never leaves the finished video behind to replay later", () => {
    const list = [video("a"), video("b")];
    expect(takeNextPlayable(["b", "a"], list, "a")).toEqual({
      video: list[1],
      rest: [],
    });
    expect(takeNextPlayable(["a"], list, "a")).toEqual({ video: null, rest: [] });
  });
});
