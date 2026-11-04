// What the library grid shows: the folder selection (libraryFilter.ts),
// then search, source and status filters, then the sort order. Pure, so the
// grid and autoplay ("play the next visible video") agree on one list.

import type { Video } from "../types";
import { filterVideos } from "./libraryFilter";
import { sourceKey, type SourceKey } from "./source";
import { displayTitle } from "./display";

export type SortKey = "recent" | "title" | "duration" | "playlist";
export type StatusFilter = "all" | "unwatched" | "watched" | "missing";

export interface LibraryQuery {
  /** Folder id, or the ALL / UNFILED sentinels. */
  folder: string;
  /** Free text matched against title and uploader, case-insensitive. */
  search: string;
  /** Empty means every source. */
  sources: SourceKey[];
  status: StatusFilter;
  sort: SortKey;
}

export const DEFAULT_QUERY: Omit<LibraryQuery, "folder"> = {
  search: "",
  sources: [],
  status: "all",
  sort: "recent",
};

export const SORT_LABELS: Record<SortKey, string> = {
  recent: "Recently added",
  title: "Title",
  duration: "Longest first",
  playlist: "Playlist order",
};

export const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "All",
  unwatched: "Unwatched",
  watched: "Watched",
  missing: "Not downloaded",
};

export function viewVideos(videos: Video[], query: LibraryQuery): Video[] {
  const needle = normalize(query.search);
  const sources = new Set(query.sources);
  const matching = filterVideos(videos, query.folder).filter(
    (video) =>
      (sources.size === 0 || sources.has(sourceKey(video.source))) &&
      matchesStatus(video, query.status) &&
      (needle === "" || haystack(video).includes(needle)),
  );
  return sortVideos(matching, query.sort);
}

function matchesStatus(video: Video, status: StatusFilter): boolean {
  switch (status) {
    case "all":
      return true;
    case "watched":
      return video.watched;
    case "unwatched":
      return !video.watched && video.file_path !== null;
    case "missing":
      return video.file_path === null;
  }
}

/** Lowercase and strip accents, so "electro" finds "Électro". */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

function haystack(video: Video): string {
  return normalize(`${displayTitle(video)} ${video.uploader ?? ""}`);
}

/**
 * "recent" keeps the order the folder filter produced (newest download
 * first, playlists in their own order). The others are stable sorts with
 * the title as a tie-breaker, so equal keys never shuffle between renders.
 */
export function sortVideos(videos: Video[], sort: SortKey): Video[] {
  const byTitle = (a: Video, b: Video) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: "base", numeric: true });
  switch (sort) {
    case "recent":
      return videos;
    case "title":
      return [...videos].sort(byTitle);
    case "duration":
      return [...videos].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0) || byTitle(a, b));
    case "playlist":
      return [...videos].sort(
        (a, b) =>
          (a.playlist_id ?? "￿").localeCompare(b.playlist_id ?? "￿") ||
          (a.playlist_index ?? Infinity) - (b.playlist_index ?? Infinity) ||
          byTitle(a, b),
      );
  }
}

/** True when any filter beyond the folder is active. */
export function isFiltered(query: LibraryQuery): boolean {
  return query.search.trim() !== "" || query.sources.length > 0 || query.status !== "all";
}

/** How many videos of each source the current folder holds (before filters). */
export function sourceCounts(videos: Video[]): Record<SourceKey | "all", number> {
  const counts = { all: videos.length, youtube: 0, twitter: 0, twitch: 0, other: 0 };
  for (const video of videos) counts[sourceKey(video.source)] += 1;
  return counts;
}

/** Total running time of the videos, in seconds; unknown durations count as 0. */
export function totalDuration(videos: Video[]): number {
  return videos.reduce((sum, video) => sum + (video.duration ?? 0), 0);
}
