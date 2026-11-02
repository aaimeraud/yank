import type { Video } from "../types";

/**
 * The implicit queue is whatever the user can see, in order. Autoplay walks
 * forward from the current video and stops at the end instead of wrapping,
 * so a folder never loops back to its first item forever.
 */
export function nextInContext(videos: Video[], currentId: string): Video | null {
  const index = videos.findIndex((video) => video.id === currentId);
  if (index === -1) return null;
  for (let i = index + 1; i < videos.length; i += 1) {
    if (videos[i].file_path) return videos[i];
  }
  return null;
}

/** Append an id once; adding the same video twice must not queue it twice. */
export function enqueueId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/**
 * What follows the current video once the explicit queue is empty. Inside a
 * folder the visible list is the whole world: reaching its last video stops
 * autoplay instead of leaking into the rest of the library. The full-library
 * fallback only applies when the current video is not part of the visible
 * list, such as a queued video opened from another folder.
 */
export function nextAfter(current: Video, visible: Video[], all: Video[]): Video | null {
  const next = nextInContext(visible, current.id);
  if (next) return next;
  if (visible.some((video) => video.id === current.id)) return null;
  return nextInContext(all, current.id);
}

/** Move an id to the front, whether or not it was already queued. */
export function playNextId(ids: string[], id: string): string[] {
  return [id, ...ids.filter((queued) => queued !== id)];
}

/**
 * Consume the first playable entry. Missing files and the video that just
 * ended are skipped, so a stale queue can never stall autoplay. Everything
 * ahead of the returned video is dropped with it, and the video that just
 * ended is removed from the remainder too: leaving it behind would replay it
 * later even though it already played.
 */
export function takeNextPlayable(
  ids: string[],
  videos: Video[],
  currentId?: string,
): { video: Video | null; rest: string[] } {
  for (let i = 0; i < ids.length; i += 1) {
    if (ids[i] === currentId) continue;
    const video = videos.find(
      (candidate) => candidate.id === ids[i] && candidate.file_path,
    );
    if (video) {
      return { video, rest: ids.slice(i + 1).filter((id) => id !== currentId) };
    }
  }
  return { video: null, rest: [] };
}
