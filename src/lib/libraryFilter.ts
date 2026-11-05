import type { Folder, Video } from "../types";

export const ALL = "all";
export const UNFILED = "unfiled";

/**
 * Sort each playlist's entries by position without moving them relative to
 * videos from somewhere else. A folder created by a playlist is the common
 * case and becomes a clean 1..n list; if the user later moves a standalone
 * video into that folder, the standalone keeps its place instead of dragging
 * the whole folder back to download-completion order.
 */
function orderPlaylistVideos(videos: Video[]): Video[] {
  if (videos.length < 2) return videos;
  // Grid positions held by each playlist's entries.
  const slots = new Map<string, number[]>();
  videos.forEach((video, index) => {
    if (!video.playlist_id || video.playlist_index == null) return;
    const positions = slots.get(video.playlist_id);
    if (positions) positions.push(index);
    else slots.set(video.playlist_id, [index]);
  });
  if (slots.size === 0) return videos;

  const next = [...videos];
  for (const positions of slots.values()) {
    const sorted = positions
      .map((slot) => videos[slot])
      .sort((a, b) => (a.playlist_index ?? Infinity) - (b.playlist_index ?? Infinity));
    positions.forEach((slot, i) => {
      next[slot] = sorted[i];
    });
  }
  return next;
}

/** The heading for a folder selection. A vanished id reads as the whole library. */
export function folderTitle(selected: string, folders: Folder[]): string {
  if (selected === UNFILED) return "Unfiled";
  return folders.find((folder) => folder.id === selected)?.name ?? "All videos";
}

/**
 * Folder selection is a single string: the sentinels above, or a folder id.
 * An id that no longer exists matches nothing, and the caller resets to ALL.
 */
export function filterVideos(videos: Video[], selected: string): Video[] {
  if (selected === ALL) return videos;
  if (selected === UNFILED) return videos.filter((video) => !video.folder_id);
  return orderPlaylistVideos(videos.filter((video) => video.folder_id === selected));
}
