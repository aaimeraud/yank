import type { Metadata, QueueItem, Video } from "../types";

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

export interface QueueEntriesOptions {
  metas: Metadata[];
  playlistId: string | null;
  downloadDir: string;
  videos: Video[];
  queue: QueueItem[];
}

const ACTIVE = new Set(["queued", "downloading", "paused"]);

/**
 * Add every playlist entry to the library and start its download.
 * Returns how many were queued, so the caller can tell the user when a
 * playlist turned out to be fully downloaded already.
 */
export async function queueEntries(
  { metas, playlistId, downloadDir, videos, queue }: QueueEntriesOptions,
  invoke: Invoke,
  newId: () => string = () => crypto.randomUUID(),
): Promise<number> {
  let queued = 0;
  for (const meta of metas) {
    // A playlist entry is only downloadable through its own watch URL; the
    // playlist URL would make yt-dlp fetch the whole list again per entry.
    const target = meta.webpage_url;
    if (!target) continue;

    const videoId = meta.id || newId();
    const existing = videos.find((v) => v.id === videoId);
    const inFlight = queue.some((q) => q.video_id === videoId && ACTIVE.has(q.status));
    if (existing?.file_path || inFlight) continue;

    await invoke("add_video", {
      video: {
        id: videoId,
        title: meta.title,
        uploader: meta.uploader,
        duration: meta.duration,
        thumbnail_path: null,
        source: meta.extractor ?? "Other",
        url: target,
        file_path: null,
        file_size: null,
        downloaded_at: null,
        last_position: 0,
        watched: false,
        playlist_id: playlistId,
      },
    });
    await invoke("start_download", {
      videoId,
      url: target,
      formatPref: "video",
      downloadDir,
    });
    queued += 1;
  }
  return queued;
}
