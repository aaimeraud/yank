// What macOS shows for the current video (Control Center, the media keys).

import { displayTitle } from "./display";
import { mediaSrc } from "./media";
import { sourceLabel } from "./source";
import type { Video } from "../types";

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  artwork: { src: string }[];
}

/**
 * Title on the first line; "Channel - YouTube" on the second. macOS writes
 * that line as "artist - album" even when one half is empty, so both are
 * always filled or a stray dash shows up.
 */
export function nowPlaying(video: Video): NowPlaying {
  return {
    title: displayTitle(video),
    artist: video.uploader || "Unknown",
    album: sourceLabel(video.source),
    artwork: video.thumbnail_path ? [{ src: mediaSrc(video.thumbnail_path) }] : [],
  };
}
