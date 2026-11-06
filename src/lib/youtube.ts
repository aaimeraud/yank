// The YouTube screen's logic, pure so it is tested without a backend:
// the search state machine, how a hit is labelled, what it can do, and how
// it becomes something the player can stream.

import type { Metadata, QueueEntry, SearchKind, SearchPage, SearchResult, Video } from "../types";
import { formatDuration } from "./format";

// ---------------------------------------------------------------- search state

export interface SearchState {
  query: string;
  kind: SearchKind;
  results: SearchResult[];
  /** Last page received, 0-based; -1 before the first. */
  page: number;
  hasMore: boolean;
  /** "loading" is a new search, "more" a next page on top of results. */
  status: "idle" | "loading" | "more" | "done" | "error";
  error: string | null;
  /**
   * Bumped by every request. An answer carries the number it was asked
   * with and is dropped unless it is still the latest, so a slow search
   * typed before the current one can never overwrite it.
   */
  request: number;
}

export const IDLE_SEARCH: SearchState = {
  query: "",
  kind: "video",
  results: [],
  page: -1,
  hasMore: false,
  status: "idle",
  error: null,
  request: 0,
};

export type SearchAction =
  | { type: "search"; query: string; kind: SearchKind }
  | { type: "more" }
  | { type: "page"; request: number; page: number; data: SearchPage }
  | { type: "failed"; request: number; error: string }
  | { type: "retry" }
  | { type: "clear" };

export function searchReducer(state: SearchState, action: SearchAction): SearchState {
  switch (action.type) {
    case "search": {
      const query = cleanQuery(action.query);
      if (!query) return { ...IDLE_SEARCH, kind: action.kind, request: state.request + 1 };
      return { ...IDLE_SEARCH, query, kind: action.kind, status: "loading", request: state.request + 1 };
    }
    case "more":
      if (!canLoadMore(state)) return state;
      return { ...state, status: "more", error: null, request: state.request + 1 };
    case "page": {
      if (action.request !== state.request) return state;
      const results = action.page === 0 ? dedupe(action.data.results) : dedupe([...state.results, ...action.data.results]);
      // A page that brought nothing new ends the list even if YouTube says
      // it has more: otherwise "Load more" could repeat forever.
      const grew = results.length > (action.page === 0 ? 0 : state.results.length);
      return { ...state, results, page: action.page, hasMore: action.data.has_more && grew, status: "done", error: null };
    }
    case "failed":
      if (action.request !== state.request) return state;
      return { ...state, status: "error", error: action.error };
    case "retry":
      // The request that failed, again: the next page when some results
      // are already shown, the first one otherwise.
      if (state.status !== "error") return state;
      if (state.page >= 0) return { ...state, status: "more", error: null, request: state.request + 1 };
      return { ...state, status: "loading", error: null, request: state.request + 1 };
    case "clear":
      return { ...IDLE_SEARCH, kind: state.kind, request: state.request + 1 };
  }
}

/** The page the latest request asks for, or null when none is in flight. */
export function pendingPage(state: SearchState): number | null {
  if (state.status === "loading") return 0;
  if (state.status === "more") return state.page + 1;
  return null;
}

export function canLoadMore(state: SearchState): boolean {
  return state.status === "done" && state.hasMore;
}

/**
 * Mirrors clean_query in src-tauri/src/ytdlp/search.rs: the cap counts
 * code points like Rust's chars, so an emoji is never cut in half (a lone
 * surrogate would not even reach the backend as valid JSON).
 */
export function cleanQuery(raw: string): string {
  return Array.from(raw.trim().split(/\s+/).join(" ")).slice(0, 200).join("").trim();
}

/** YouTube repeats a hit across continuation pages now and then. */
function dedupe(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((hit) => {
    const key = `${hit.kind}:${hit.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Most recent first, case-insensitive duplicates folded, at most `max`. */
export function rememberSearch(recent: string[], query: string, max = 8): string[] {
  const clean = cleanQuery(query);
  if (!clean) return recent;
  return [clean, ...recent.filter((past) => past.toLowerCase() !== clean.toLowerCase())].slice(0, max);
}

// ---------------------------------------------------------------- one hit

export function isLive(hit: Pick<SearchResult, "live_status">): boolean {
  return hit.live_status === "is_live";
}

export function isUpcoming(hit: Pick<SearchResult, "live_status">): boolean {
  return hit.live_status === "is_upcoming";
}

/** 1 -> "1 view", 48_213 -> "48K views", 1_234_567 -> "1.2M views". */
export function formatViews(count: number | null | undefined): string {
  if (count === null || count === undefined || !Number.isFinite(count) || count < 0) return "";
  if (count === 1) return "1 view";
  const short = (n: number, unit: string) => `${n >= 10 ? Math.floor(n) : Math.floor(n * 10) / 10}${unit}`;
  if (count >= 1e9) return `${short(count / 1e9, "B")} views`;
  if (count >= 1e6) return `${short(count / 1e6, "M")} views`;
  if (count >= 1e3) return `${short(count / 1e3, "K")} views`;
  return `${count} views`;
}

/** The line under a card's title: channel and views (watching, for a live). */
export function resultMeta(hit: SearchResult): string {
  const views = formatViews(hit.view_count);
  const parts = [hit.channel ?? "Unknown channel"];
  if (views) parts.push(isLive(hit) ? views.replace("views", "watching") : views);
  return parts.join(" · ");
}

/** The corner label: a duration, LIVE, Upcoming, or Playlist. */
export function resultBadge(hit: SearchResult): string {
  if (hit.kind === "playlist") return "Playlist";
  if (isLive(hit)) return "Live";
  if (isUpcoming(hit)) return "Upcoming";
  return formatDuration(hit.duration);
}

/**
 * Why a hit cannot be downloaded, or null when it can. A live stream would
 * record until it ends (hours, or never for a 24/7 radio); an upcoming one
 * has nothing to fetch yet.
 */
export function downloadBlocker(hit: SearchResult): string | null {
  if (isLive(hit)) return "Live streams can be watched, not downloaded.";
  if (isUpcoming(hit)) return "This premiere has not started yet.";
  return null;
}

/** Why a hit cannot be watched here, or null when it can. */
export function watchBlocker(hit: SearchResult): string | null {
  if (isUpcoming(hit)) return "This premiere has not started yet.";
  return null;
}

export type HitState =
  | { kind: "downloaded"; video: Video }
  | { kind: "downloading"; entry: QueueEntry }
  | { kind: "none" };

/** A video hit against the library: on disk, on its way, or neither. */
export function hitState(hit: SearchResult, library: Map<string, Video>, downloads: Map<string, QueueEntry>): HitState {
  if (hit.kind !== "video") return { kind: "none" };
  const video = library.get(hit.id);
  if (video?.file_path) return { kind: "downloaded", video };
  const entry = downloads.get(hit.id);
  if (entry) return { kind: "downloading", entry };
  return { kind: "none" };
}

/** A playlist's entry as a hit, so the playlist view reuses the card. */
export function entryToHit(entry: Metadata): SearchResult | null {
  if (!entry.id || !entry.webpage_url) return null;
  return {
    kind: "video",
    id: entry.id,
    title: entry.title,
    url: entry.webpage_url,
    channel: entry.uploader,
    duration: entry.duration,
    view_count: null,
    thumbnail: entry.thumbnail,
    live_status: entry.live_status ?? null,
  };
}

/** "[Private video]" and "[Deleted video]" entries of a playlist. */
export function isUnavailable(hit: SearchResult): boolean {
  return /^\[(private|deleted) video\]$/i.test(hit.title.trim());
}

// ---------------------------------------------------------------- streaming

/**
 * What the player shows for a streamed hit. The library's own row when the
 * video is in it (so the position it resumes from and saves to is that
 * row's), otherwise a stand-in that exists only in memory; its saves update
 * nothing (no row has its id).
 */
export function streamTarget(hit: SearchResult, library: Map<string, Video>): Video {
  const known = library.get(hit.id);
  if (known) return { ...known, thumbnail_path: known.thumbnail_path ?? hit.thumbnail };
  return {
    id: hit.id,
    title: hit.title,
    uploader: hit.channel,
    duration: hit.duration,
    thumbnail_path: hit.thumbnail,
    source: "youtube",
    url: hit.url,
    file_path: null,
    file_size: null,
    downloaded_at: null,
    last_position: 0,
    watched: false,
    playlist_id: null,
    folder_id: null,
    playlist_index: null,
  };
}

/** Streams expire after about six hours; a resolved URL is reused for one. */
export const STREAM_TTL_MS = 60 * 60 * 1000;

export function isFresh(resolvedAt: number, now: number): boolean {
  return now - resolvedAt < STREAM_TTL_MS;
}

/** How many playlist entries the view shows before "Show more". */
export const PLAYLIST_STEP = 48;
