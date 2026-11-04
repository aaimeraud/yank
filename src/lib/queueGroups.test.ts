import { describe, expect, test } from "bun:test";
import { makeQueueEntry } from "../test/fixtures";
import { applyProgress, errorHeadline, replayEvents, groupProgress, groupQueue, groupSummary } from "./queueGroups";

const playlistRow = (id: string, index: number, status: "done" | "failed" | "downloading" | "queued", progress = 0) =>
  makeQueueEntry(id, {
    playlist_id: "p1",
    playlist_title: "Systems Design",
    playlist_index: index,
    status,
    progress,
  });

describe("groupQueue", () => {
  test("groups playlist rows in playlist order and keeps standalones apart", () => {
    const rows = [
      makeQueueEntry("solo"),
      playlistRow("third", 3, "queued"),
      playlistRow("first", 1, "done"),
      makeQueueEntry("solo2"),
      playlistRow("second", 2, "failed"),
    ];
    const groups = groupQueue(rows);
    expect(groups.map((g) => g.key)).toEqual(["solo", "p1", "solo2"]);
    expect(groups[1].title).toBe("Systems Design");
    expect(groups[1].entries.map((e) => e.id)).toEqual(["first", "second", "third"]);
    expect(groups[0].title).toBeNull();
  });

  test("summarises a partial failure the way the spec words it", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => playlistRow(`d${i}`, i + 1, "done")),
      ...Array.from({ length: 3 }, (_, i) => playlistRow(`f${i}`, i + 13, "failed")),
    ];
    expect(groupSummary(groupQueue(rows)[0])).toBe("12 of 15 downloaded · 3 failed");
  });

  test("progress counts finished rows as complete", () => {
    const [group] = groupQueue([playlistRow("a", 1, "done", 40), playlistRow("b", 2, "downloading", 50)]);
    expect(groupProgress(group)).toBe(75);
  });
});

describe("applyProgress", () => {
  const rows = [makeQueueEntry("q1", { status: "downloading", progress: 10, speed: "100", error: "old" }), makeQueueEntry("q2")];

  test("patches only the matching row and keeps fields the event omits", () => {
    const next = applyProgress(rows, { queue_id: "q1", status: "downloading", progress: 42, speed: "100", eta: null });
    expect(next[0]).toMatchObject({ progress: 42, speed: "100", error: "old" });
    expect(next[1]).toBe(rows[1]);
  });

  test("an empty error string clears the error (sent on an automatic retry)", () => {
    const next = applyProgress(rows, { queue_id: "q1", status: "downloading", progress: 0, error: "", speed: null, eta: null });
    expect(next[0].error).toBeNull();
    expect(next[0].speed).toBeNull();
  });

  test("a status-only event clears the previous attempt's speed", () => {
    const next = applyProgress(rows, { queue_id: "q1", status: "paused", speed: null, eta: null });
    expect(next[0]).toMatchObject({ status: "paused", progress: 10, speed: null });
  });
});

describe("replayEvents", () => {
  /** Regression: a reload that started before a download finished came back
   * with "downloading" and overwrote the "done" the event had set. */
  test("events newer than the snapshot win", () => {
    const stale = [makeQueueEntry("q1", { status: "downloading", progress: 99 })];
    const done = { queue_id: "q1", status: "done" as const, progress: 100, speed: null, eta: null };
    expect(replayEvents(stale, [done])[0]).toMatchObject({ status: "done", progress: 100 });
    expect(replayEvents(stale, [])).toBe(stale);
  });
});

describe("errorHeadline", () => {
  test("shows the last ERROR line without its prefix", () => {
    const stderr = "WARNING: [youtube] something\nERROR: [youtube] abc: Private video. Sign in\n";
    expect(errorHeadline(stderr)).toBe("[youtube] abc: Private video. Sign in");
  });
  test("falls back to the last line", () => {
    expect(errorHeadline("Could not start yt-dlp: No such file")).toBe("Could not start yt-dlp: No such file");
    expect(errorHeadline("")).toBe("");
    expect(errorHeadline(null)).toBe("");
  });
});
