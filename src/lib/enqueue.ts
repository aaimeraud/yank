// What to tell the user after a URL was submitted.

import type { EnqueueSummary } from "../types";
import { plural } from "./format";

export function enqueueMessage(summary: EnqueueSummary): string {
  const { title, is_playlist, queued, skipped } = summary;
  if (!is_playlist) {
    return queued > 0 ? `Downloading "${title}".` : `"${title}" is already in the library or the queue.`;
  }
  if (queued === 0) return `Everything in "${title}" is already downloaded or queued.`;
  const rest = skipped > 0 ? ` (${skipped} already there)` : "";
  return `Queued ${plural(queued, "video")} from "${title}"${rest}.`;
}

/** Cheap check before calling yt-dlp: it only accepts absolute http(s) URLs. */
export function looksLikeUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
