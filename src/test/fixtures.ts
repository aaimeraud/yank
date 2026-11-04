// Builders shared by the unit tests. Not imported by app code.

import type { QueueEntry, Video } from "../types";

/** A downloaded video with every field set; override what the test cares about. */
export function makeVideo(id: string, overrides: Partial<Video> = {}): Video {
  return {
    id,
    title: `Video ${id}`,
    uploader: null,
    duration: null,
    thumbnail_path: null,
    source: "youtube",
    url: `https://www.youtube.com/watch?v=${id}`,
    file_path: `/tmp/${id}.mp4`,
    file_size: null,
    downloaded_at: null,
    last_position: 0,
    watched: false,
    playlist_id: null,
    folder_id: null,
    playlist_index: null,
    ...overrides,
  };
}

export function makeQueueEntry(id: string, overrides: Partial<QueueEntry> = {}): QueueEntry {
  return {
    id,
    video_id: `v-${id}`,
    status: "queued",
    progress: 0,
    speed: null,
    eta: null,
    error: null,
    created_at: 0,
    format: "video",
    title: `Video ${id}`,
    url: `https://www.youtube.com/watch?v=${id}`,
    source: "youtube",
    playlist_id: null,
    playlist_title: null,
    playlist_index: null,
    ...overrides,
  };
}
