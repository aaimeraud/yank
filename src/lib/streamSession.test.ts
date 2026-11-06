import { describe, expect, test } from "bun:test";
import { makeVideo } from "../test/fixtures";
import {
  currentItem,
  forgetFiles,
  moveTo,
  nextStep,
  patchPlayback,
  previousIndex,
  resumeAt,
  retryPosition,
  sessionSource,
  syncFromLibrary,
  type StreamItem,
  type StreamSession,
} from "./streamSession";

const item = (id: string, overrides: Partial<StreamItem> = {}, file: string | null = null): StreamItem => ({
  video: makeVideo(id, { file_path: file }),
  url: `https://www.youtube.com/watch?v=${id}`,
  live: false,
  ...overrides,
});

const session = (index = 0): StreamSession => ({ items: [item("a"), item("b"), item("c", {}, "/m/c.mp4")], index, label: "q" });
const fileSrc = (path: string) => `asset://${path}`;

describe("moving through a session", () => {
  test("next goes through the list, then stops", () => {
    expect(nextStep(session(0), null)).toEqual({ from: "session", index: 1 });
    expect(nextStep(session(2), null)).toBeNull();
  });

  /** "Play next" means next, even while streaming search results. */
  test("the user's queue comes before the session", () => {
    expect(nextStep(session(0), "lib-1")).toEqual({ from: "queue" });
    expect(nextStep(session(2), "lib-1")).toEqual({ from: "queue" });
  });

  test("previous and moveTo stay in bounds", () => {
    expect(previousIndex(session(0))).toBeNull();
    expect(previousIndex(session(2))).toBe(1);
    expect(moveTo(session(0), 2)?.index).toBe(2);
    expect(moveTo(session(0), 3)).toBeNull();
    expect(currentItem(session(1))?.video.id).toBe("b");
    expect(currentItem(null)).toBeNull();
  });
});

describe("keeping items current", () => {
  /** Regression: Previous to a streamed video restarted it at 0. */
  test("a saved position reaches the item, so going back resumes", () => {
    const before = session(1);
    const watched = patchPlayback(before, "a", 480, false);
    expect(watched.items[0].video.last_position).toBe(480);
    // Untouched items keep their identity, so React skips them.
    expect(watched.items[1]).toBe(before.items[1]);
    const same = session(0);
    expect(patchPlayback(same, "nobody", 10, false)).toBe(same);
    expect(patchPlayback(watched, "a", 480, false)).toBe(watched);
    expect(patchPlayback(watched, "a", 500, true).items[0].video.watched).toBe(true);
  });

  /** Regression: a hit downloaded while its list streamed was still streamed. */
  test("items follow the library, except the one playing", () => {
    const s = session(0);
    const library = new Map([
      ["a", makeVideo("a", { file_path: "/m/a.mp4" })],
      ["b", makeVideo("b", { file_path: "/m/b.mp4" })],
      ["c", makeVideo("c", { file_path: null })],
    ]);
    const synced = syncFromLibrary(s, library);
    expect(synced.items[0]).toBe(s.items[0]);
    expect(synced.items[1].video.file_path).toBe("/m/b.mp4");
    expect(synced.items[2].video.file_path).toBeNull();
    expect(syncFromLibrary(synced, library)).toBe(synced);
    // Moving to an item: it takes its file too.
    expect(syncFromLibrary(s, library, true).items[0].video.file_path).toBe("/m/a.mp4");
  });

  test("a deleted file turns its item into a stream", () => {
    const s = session(0);
    const after = forgetFiles(s, ["c"]);
    expect(after.items[2].video.file_path).toBeNull();
    expect(forgetFiles(s, ["a"])).toBe(s);
  });

  /** Regression: Try again after a failed resolve restarted at 0 and the next save erased 20:00. */
  test("a retry with nothing reported keeps the item's resume point", () => {
    const resumable = item("a", { video: makeVideo("a", { file_path: null, last_position: 1200 }) });
    expect(retryPosition(resumable, 0)).toBe(1200);
    expect(retryPosition(resumable, 1290.5)).toBe(1290.5);
  });

  test("a retry resumes the current item where it stopped", () => {
    const before = session(1);
    const s = resumeAt(before, 75.9);
    expect(s.items[1].video.last_position).toBe(75);
    expect(s.items[0]).toBe(before.items[0]);
    expect(resumeAt(session(1), -4).items[1].video.last_position).toBe(0);
  });
});

describe("sessionSource", () => {
  const a = item("a");
  const resolvedA = { url: a.url, stream: { url: "https://m/a.m3u8", is_hls: true, is_live: false } };

  test("an item on disk plays its file, nothing to resolve", () => {
    const source = sessionSource(item("c", {}, "/m/c.mp4"), null, null, fileSrc);
    expect(source).toEqual({ src: "asset:///m/c.mp4", streaming: false, loading: false, error: null, isLive: false });
  });

  test("loading until the stream for this item arrives", () => {
    expect(sessionSource(a, null, null, fileSrc)).toMatchObject({ src: undefined, streaming: true, loading: true });
    expect(sessionSource(a, resolvedA, null, fileSrc)).toMatchObject({ src: "https://m/a.m3u8", loading: false });
  });

  /** A late answer for the previous item must not play under this one. */
  test("a stream resolved for another item never applies", () => {
    const b = item("b");
    expect(sessionSource(b, resolvedA, null, fileSrc)).toMatchObject({ src: undefined, loading: true });
  });

  test("an error stops the spinner", () => {
    expect(sessionSource(a, null, "ERROR: Private video", fileSrc)).toMatchObject({ loading: false, error: "ERROR: Private video" });
  });

  /** Regression: Download showed for a live hit until its stream resolved. */
  test("a live hit is live before it resolves", () => {
    expect(sessionSource(item("l", { live: true }), null, null, fileSrc).isLive).toBe(true);
    expect(sessionSource(item("l", { live: true }), null, "failed", fileSrc).isLive).toBe(true);
    const live = { url: a.url, stream: { ...resolvedA.stream, is_live: true } };
    expect(sessionSource(a, live, null, fileSrc).isLive).toBe(true);
  });
});
