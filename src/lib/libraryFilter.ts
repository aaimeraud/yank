import type { Video } from "../types";

export const ALL = "all";
export const UNFILED = "unfiled";

/**
 * Folder selection is a single string: the sentinels above, or a folder id.
 * An id that no longer exists matches nothing, and the caller resets to ALL.
 */
export function filterVideos(videos: Video[], selected: string): Video[] {
  if (selected === ALL) return videos;
  if (selected === UNFILED) return videos.filter((video) => !video.folder_id);
  return videos.filter((video) => video.folder_id === selected);
}
