// What macOS shows for the current video (Control Center, the media keys).

import { displayTitle } from "./display";
import { mediaSrc } from "./media";
import { sourceLabel } from "./source";
import type { Video } from "../types";

export interface NowPlaying {
  title: string;
  artist: string;
  artwork: { src: string }[];
}

/** Title on the first line; "Channel · YouTube" on the second. */
export function nowPlaying(video: Video): NowPlaying {
  return {
    title: displayTitle(video),
    artist: [video.uploader, sourceLabel(video.source)].filter(Boolean).join(" · "),
    artwork: video.thumbnail_path ? [{ src: mediaSrc(video.thumbnail_path) }] : [],
  };
}
