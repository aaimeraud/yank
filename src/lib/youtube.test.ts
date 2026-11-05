import { describe, expect, test } from "bun:test";
import { makeQueueEntry, makeVideo } from "../test/fixtures";
import type { SearchPage, SearchResult } from "../types";
import {
  IDLE_SEARCH,
  canLoadMore,
  cleanQuery,
  downloadBlocker,
  entryToHit,
  formatViews,
  hitState,
  isFresh,
  isUnavailable,
  pendingPage,
  rememberSearch,
  resultBadge,
  resultMeta,
  searchReducer,
  streamTarget,
  watchBlocker,
  STREAM_TTL_MS,
  type SearchState,
} from "./youtube";

function hit(id: string, overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    kind: "video",
    id,
    title: `Hit ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    channel: "Channel",
    duration: 61,
    view_count: 1200,
    thumbnail: `https://i.ytimg.com/vi/${id}/hq720.jpg`,
    live_status: null,
    ...overrides,
  };
}

const page = (ids: string[], has_more = true): SearchPage => ({ results: ids.map((id) => hit(id)), has_more });

function run(state: SearchState, ...actions: Parameters<typeof searchReducer>[1][]): SearchState {
  return actions.reduce(searchReducer, state);
}

describe("searchReducer", () => {
  test("a search loads page 0, then shows its results", () => {
    const loading = run(IDLE_SEARCH, { type: "search", query: "  lofi  beats ", kind: "video" });
    expect(loading.status).toBe("loading");
    expect(loading.query).toBe("lofi beats");
    expect(pendingPage(loading)).toBe(0);
    const done = run(loading, { type: "page", request: loading.request, page: 0, data: page(["a", "b"]) });
    expect(done.results.map((r) => r.id)).toEqual(["a", "b"]);
    expect(done.status).toBe("done");
    expect(canLoadMore(done)).toBe(true);
    expect(pendingPage(done)).toBeNull();
  });

  /** Regression guard: typing a second query before the first answers. */
  test("an answer to an older request is dropped", () => {
    const first = run(IDLE_SEARCH, { type: "search", query: "cats", kind: "video" });
    const second = run(first, { type: "search", query: "dogs", kind: "video" });
    const late = run(second, { type: "page", request: first.request, page: 0, data: page(["cat"]) });
    expect(late).toBe(second);
    const lateError = run(second, { type: "failed", request: first.request, error: "boom" });
    expect(lateError.status).toBe("loading");
  });

  test("more appends the next page and folds repeats", () => {
    let state = run(IDLE_SEARCH, { type: "search", query: "q", kind: "video" });
    state = run(state, { type: "page", request: state.request, page: 0, data: page(["a", "b"]) });
    state = run(state, { type: "more" });
    expect(state.status).toBe("more");
    expect(pendingPage(state)).toBe(1);
    expect(state.results).toHaveLength(2);
    state = run(state, { type: "page", request: state.request, page: 1, data: page(["b", "c"]) });
    expect(state.results.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(state.page).toBe(1);
  });

  test("a page that brings nothing new ends the list", () => {
    let state = run(IDLE_SEARCH, { type: "search", query: "q", kind: "video" });
    state = run(state, { type: "page", request: state.request, page: 0, data: page(["a"]) });
    state = run(state, { type: "more" });
    state = run(state, { type: "page", request: state.request, page: 1, data: page(["a"], true) });
    expect(state.hasMore).toBe(false);
    expect(run(state, { type: "more" })).toBe(state);
  });

  test("more does nothing while loading, after the end, or after an error", () => {
    const loading = run(IDLE_SEARCH, { type: "search", query: "q", kind: "video" });
    expect(run(loading, { type: "more" })).toBe(loading);
    const last = run(loading, { type: "page", request: loading.request, page: 0, data: page(["a"], false) });
    expect(run(last, { type: "more" })).toBe(last);
    const failed = run(loading, { type: "failed", request: loading.request, error: "ERROR: offline" });
    expect(failed.error).toBe("ERROR: offline");
    expect(run(failed, { type: "more" })).toBe(failed);
  });

  test("a failed next page keeps the results already shown", () => {
    let state = run(IDLE_SEARCH, { type: "search", query: "q", kind: "video" });
    state = run(state, { type: "page", request: state.request, page: 0, data: page(["a"]) });
    state = run(state, { type: "more" }, { type: "failed", request: state.request + 1, error: "x" });
    expect(state.status).toBe("error");
    expect(state.results.map((r) => r.id)).toEqual(["a"]);
  });

  test("retry asks again for the page that failed", () => {
    const loading = run(IDLE_SEARCH, { type: "search", query: "q", kind: "video" });
    const failedFirst = run(loading, { type: "failed", request: loading.request, error: "x" });
    const again = run(failedFirst, { type: "retry" });
    expect(again.status).toBe("loading");
    expect(pendingPage(again)).toBe(0);
    expect(again.request).toBe(failedFirst.request + 1);

    let shown = run(loading, { type: "page", request: loading.request, page: 0, data: page(["a"]) });
    shown = run(shown, { type: "more" });
    shown = run(shown, { type: "failed", request: shown.request, error: "x" });
    const next = run(shown, { type: "retry" });
    expect(pendingPage(next)).toBe(1);
    expect(next.results.map((r) => r.id)).toEqual(["a"]);
    // Nothing to retry unless something failed.
    expect(run(loading, { type: "retry" })).toBe(loading);
  });

  test("an empty query goes back to idle and outdates what was in flight", () => {
    const loading = run(IDLE_SEARCH, { type: "search", query: "q", kind: "playlist" });
    const cleared = run(loading, { type: "search", query: "   ", kind: "playlist" });
    expect(cleared.status).toBe("idle");
    expect(cleared.kind).toBe("playlist");
    expect(run(cleared, { type: "page", request: loading.request, page: 0, data: page(["a"]) })).toBe(cleared);
    expect(run(loading, { type: "clear" }).status).toBe("idle");
  });

  test("switching kind is a new search", () => {
    let state = run(IDLE_SEARCH, { type: "search", query: "q", kind: "video" });
    state = run(state, { type: "page", request: state.request, page: 0, data: page(["a"]) });
    state = run(state, { type: "search", query: "q", kind: "playlist" });
    expect(state.results).toEqual([]);
    expect(state.kind).toBe("playlist");
    expect(state.status).toBe("loading");
  });
});

test("cleanQuery trims, collapses and caps like the backend", () => {
  expect(cleanQuery("  a \n  b ")).toBe("a b");
  expect(cleanQuery("x".repeat(300))).toHaveLength(200);
  expect(cleanQuery(" ")).toBe("");
  // Counted in code points, like the backend: no half emoji.
  const emoji = cleanQuery("😀".repeat(300));
  expect(Array.from(emoji)).toHaveLength(200);
  expect(emoji.endsWith("😀")).toBe(true);
});

test("rememberSearch keeps the latest first, folds case, caps", () => {
  expect(rememberSearch(["Rust", "lofi"], "rust ")).toEqual(["rust", "lofi"]);
  expect(rememberSearch([], "  ")).toEqual([]);
  const many = Array.from({ length: 8 }, (_, i) => `q${i}`);
  expect(rememberSearch(many, "new")).toEqual(["new", ...many.slice(0, 7)]);
});

test("formatViews shortens like YouTube", () => {
  expect(formatViews(0)).toBe("0 views");
  expect(formatViews(1)).toBe("1 view");
  expect(formatViews(999)).toBe("999 views");
  expect(formatViews(1_250)).toBe("1.2K views");
  expect(formatViews(48_213)).toBe("48K views");
  expect(formatViews(1_999_999)).toBe("1.9M views");
  expect(formatViews(3_100_000_000)).toBe("3.1B views");
  expect(formatViews(null)).toBe("");
  expect(formatViews(Number.NaN)).toBe("");
});

test("labels: badge and meta line per kind", () => {
  expect(resultBadge(hit("a", { duration: 3725 }))).toBe("1:02:05");
  expect(resultBadge(hit("a", { duration: null }))).toBe("");
  expect(resultBadge(hit("a", { live_status: "is_live", duration: null }))).toBe("Live");
  expect(resultBadge(hit("a", { live_status: "is_upcoming" }))).toBe("Upcoming");
  expect(resultBadge(hit("p", { kind: "playlist" }))).toBe("Playlist");
  expect(resultMeta(hit("a"))).toBe("Channel · 1.2K views");
  expect(resultMeta(hit("a", { live_status: "is_live", view_count: 3400 }))).toBe("Channel · 3.4K watching");
  expect(resultMeta(hit("a", { channel: null, view_count: null }))).toBe("Unknown channel");
});

test("live streams watch but do not download; premieres do neither", () => {
  expect(downloadBlocker(hit("a"))).toBeNull();
  expect(watchBlocker(hit("a"))).toBeNull();
  expect(downloadBlocker(hit("a", { live_status: "is_live" }))).toContain("Live");
  expect(watchBlocker(hit("a", { live_status: "is_live" }))).toBeNull();
  expect(downloadBlocker(hit("a", { live_status: "is_upcoming" }))).not.toBeNull();
  expect(watchBlocker(hit("a", { live_status: "is_upcoming" }))).not.toBeNull();
  // A finished live is an ordinary video.
  expect(downloadBlocker(hit("a", { live_status: "was_live" }))).toBeNull();
});

test("hitState: on disk beats in the queue beats nothing", () => {
  const library = new Map([
    ["on-disk", makeVideo("on-disk")],
    ["gone", makeVideo("gone", { file_path: null })],
  ]);
  const downloads = new Map([["gone", makeQueueEntry("q1", { video_id: "gone", status: "downloading" })]]);
  expect(hitState(hit("on-disk"), library, downloads).kind).toBe("downloaded");
  expect(hitState(hit("gone"), library, downloads).kind).toBe("downloading");
  expect(hitState(hit("new"), library, downloads).kind).toBe("none");
  expect(hitState(hit("on-disk", { kind: "playlist" }), library, downloads).kind).toBe("none");
});

describe("streamTarget", () => {
  test("a hit outside the library becomes an in-memory stand-in", () => {
    const video = streamTarget(hit("abc"), new Map());
    expect(video.id).toBe("abc");
    expect(video.file_path).toBeNull();
    expect(video.thumbnail_path).toBe("https://i.ytimg.com/vi/abc/hq720.jpg");
    expect(video.last_position).toBe(0);
    expect(video.source).toBe("youtube");
  });

  test("a hit in the library uses its row, so it resumes and saves there", () => {
    const row = makeVideo("abc", { file_path: null, last_position: 300, thumbnail_path: null });
    const video = streamTarget(hit("abc"), new Map([["abc", row]]));
    expect(video.last_position).toBe(300);
    expect(video.thumbnail_path).toBe("https://i.ytimg.com/vi/abc/hq720.jpg");
    const withThumb = makeVideo("abc", { thumbnail_path: "/local/abc.jpg" });
    expect(streamTarget(hit("abc"), new Map([["abc", withThumb]])).thumbnail_path).toBe("/local/abc.jpg");
  });
});

test("entryToHit maps a playlist entry and skips ones without a URL", () => {
  const entry = { id: "v1", title: "One", uploader: "Up", duration: 30, thumbnail: "https://t", extractor: "Youtube", webpage_url: "https://www.youtube.com/watch?v=v1", index: 1, live_status: null };
  expect(entryToHit(entry)).toMatchObject({ kind: "video", id: "v1", channel: "Up", duration: 30, url: entry.webpage_url });
  expect(entryToHit({ ...entry, webpage_url: null })).toBeNull();
  // Regression: a live entry of a playlist offered Download.
  const live = entryToHit({ ...entry, live_status: "is_live" })!;
  expect(downloadBlocker(live)).not.toBeNull();
  expect(isUnavailable(hit("x", { title: "[Private video]" }))).toBe(true);
  expect(isUnavailable(hit("x", { title: " [Deleted video] " }))).toBe(true);
  expect(isUnavailable(hit("x", { title: "[Private video] remake" }))).toBe(false);
});

test("a resolved stream is reused for an hour", () => {
  expect(isFresh(0, STREAM_TTL_MS - 1)).toBe(true);
  expect(isFresh(0, STREAM_TTL_MS)).toBe(false);
});
