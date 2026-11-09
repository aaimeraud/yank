// Where the queue is shown, if anywhere. The player is the only thing that
// opens it, so with nothing playing there is no queue to show.

import type { PlayerMode } from "../hooks/usePlayer";

export type QueuePlacement = "side" | "mini" | "none";

export function queuePlacement(open: boolean, mode: PlayerMode, playing: boolean): QueuePlacement {
  if (!open || !playing) return "none";
  return mode === "mini" ? "mini" : "side";
}
