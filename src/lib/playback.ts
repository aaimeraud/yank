/** A video counts as watched once 90% of it has played. */
export const WATCHED_RATIO = 0.9;

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
