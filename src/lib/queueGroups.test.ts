import { describe, expect, test } from "bun:test";
import { makeQueueEntry } from "../test/fixtures";
import { applyProgress, errorHeadline, intakeSummary, queueHeadline, replayEvents, groupProgress, groupQueue, groupSummary } from "./queueGroups";

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

describe("intakeSummary", () => {
  test("names the furthest-along download and averages active progress", () => {
    const queue = [
      makeQueueEntry("a", { status: "downloading", progress: 40, title: "Slow one" }),
      makeQueueEntry("b", { status: "downloading", progress: 80, title: "Nearly there" }),
      makeQueueEntry("c", { status: "queued", progress: 0 }),
      makeQueueEntry("d", { status: "done", progress: 100 }),
    ];
    const summary = intakeSummary(queue);
    expect(summary.active).toBe(3);
    expect(summary.progress).toBe(40);
    expect(summary.current?.title).toBe("Nearly there");
    expect(summary.label).toBe("2 downloading, 1 waiting · 40%");
  });

  test("says when nothing runs, and mentions failures", () => {
    expect(intakeSummary([]).label).toBe("Nothing downloading");
    expect(intakeSummary([makeQueueEntry("x", { status: "failed" })]).label).toBe("1 failed");
  });
});

test("queueHeadline lists what is in the queue in a fixed order", () => {
  const queue = [
    makeQueueEntry("a", { status: "done" }),
    makeQueueEntry("b", { status: "failed" }),
    makeQueueEntry("c", { status: "downloading" }),
    makeQueueEntry("d", { status: "done" }),
  ];
  expect(queueHeadline(queue)).toBe("1 downloading · 1 failed · 2 done");
  expect(queueHeadline([])).toBe("Nothing in the queue.");
});
