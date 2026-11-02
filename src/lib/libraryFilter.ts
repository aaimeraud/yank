import type { Video } from "../types";

export const ALL = "all";
export const UNFILED = "unfiled";

/**
 * Sort each playlist's entries by position without moving them relative to
 * videos from somewhere else. A folder created by a playlist is the common
 * case and becomes a clean 1..n list; if the user later moves a standalone
 * video into that folder, the standalone keeps its place instead of dragging
 * the whole folder back to download-completion order.
 */
export function orderPlaylistVideos(videos: Video[]): Video[] {
  if (videos.length < 2) return videos;
  const groups = new Map<string, Video[]>();
  const slots = new Map<string, number[]>();
  videos.forEach((video, index) => {
    if (!video.playlist_id || video.playlist_index == null) return;
    const key = video.playlist_id;
    const members = groups.get(key);
    if (members) members.push(video);
    else groups.set(key, [video]);
    const positions = slots.get(key);
    if (positions) positions.push(index);
    else slots.set(key, [index]);
  });
  if (groups.size === 0) return videos;

  const next = [...videos];
  for (const [key, members] of groups) {
    const sorted = [...members].sort(
      (a, b) => (a.playlist_index ?? Infinity) - (b.playlist_index ?? Infinity),
    );
    slots.get(key)!.forEach((slot, i) => {
      next[slot] = sorted[i];
    });
  }
  return next;
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
