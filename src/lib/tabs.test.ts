import { describe, expect, test } from "bun:test";
import type { Video } from "../types";
import { advanceTabs } from "./tabs";

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

describe("advanceTabs", () => {
  test("replaces the active tab in place and keeps the rest", () => {
    const state = { tabs: [video("a"), video("b")], activeId: "a" };
    const next = advanceTabs(state, video("c"));

    expect(next.activeId).toBe("c");
    expect(next.tabs.map((tab) => tab.id)).toEqual(["c", "b"]);
  });

  test("selects an already open tab and drops the one it replaced", () => {
    const state = { tabs: [video("a"), video("b"), video("c")], activeId: "a" };
    const next = advanceTabs(state, video("c"));

    expect(next.activeId).toBe("c");
    expect(next.tabs.map((tab) => tab.id)).toEqual(["b", "c"]);
  });

  test("appends when no tab is active", () => {
    const state = { tabs: [video("a")], activeId: null };
    const next = advanceTabs(state, video("b"));

    expect(next.activeId).toBe("b");
    expect(next.tabs.map((tab) => tab.id)).toEqual(["a", "b"]);
  });

  test("updates an open tab instead of duplicating it", () => {
    const state = { tabs: [video("a")], activeId: null };
    const refreshed = video("a", { title: "New title" });
    const next = advanceTabs(state, refreshed);

    expect(next.tabs).toHaveLength(1);
    expect(next.tabs[0].title).toBe("New title");
    expect(next.activeId).toBe("a");
  });

  test("ignores a video that has no file yet", () => {
    const state = { tabs: [video("a")], activeId: "a" };
    expect(advanceTabs(state, video("b", { file_path: null }))).toEqual(state);
  });
});
