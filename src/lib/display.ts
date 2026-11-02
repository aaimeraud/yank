import type { Video } from "../types";

/**
 * The number a playlist entry is shown under. The stored title stays exactly
 * as the uploader wrote it, so a playlist reorder only changes the position
 * column and never rewrites the title itself.
 */
export function displayTitle(
  video: Pick<Video, "title" | "playlist_index">,
): string {
  const index = video.playlist_index;
  if (!index || index < 1) return video.title;
  return `${String(index).padStart(2, "0")}. ${video.title}`;
}
