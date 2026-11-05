import type { Video } from "../types";

/** A video counts as watched once 90% of it has played. */
const WATCHED_RATIO = 0.9;

/**
 * The library's copy of a video after a save, mirroring the backend: the
 * position follows the player, watched only ever turns on. Same object when
 * nothing changed, so React skips the re-render.
 */
export function patchPlayback(video: Video, position: number, watched: boolean): Video {
  const next = video.watched || watched;
  if (video.last_position === position && video.watched === next) return video;
  return { ...video, last_position: position, watched: next };
}

/**
 * What to persist for a video. The duration has to be the one captured while
 * that video was on screen: by the time the player cleans up, the element may
 * already be loading the next tab's file and report its duration instead.
 */
export function playbackSnapshot(position: number, duration: number) {
  return {
    position: Math.max(0, Math.floor(position)),
    watched: duration > 0 && position / duration >= WATCHED_RATIO,
  };
}
