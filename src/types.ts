// Mirrors of the Rust types in src-tauri/src/models.rs and settings.rs.
// Change both sides together.

export type View = "library" | "downloads" | "settings";

/** What yt-dlp is asked for. See ADR 0002. */
export type Format = "video" | "audio" | "original";

export interface Video {
  /** The id yt-dlp reports (a YouTube id, a tweet id...). */
  id: string;
  title: string;
  uploader: string | null;
  /** Seconds. */
  duration: number | null;
  thumbnail_path: string | null;
  /** yt-dlp extractor name; map it with lib/source.ts. */
  source: string;
  url: string;
  /** Set once the file is on disk. */
  file_path: string | null;
  /** Bytes. */
  file_size: number | null;
  /** Unix seconds. */
  downloaded_at: number | null;
  /** Seconds where playback last stopped. */
  last_position: number;
  watched: boolean;
  playlist_id: string | null;
  folder_id: string | null;
  /** 1-based position in its playlist, or null for a standalone video. */
  playlist_index: number | null;
}

export interface Folder {
  id: string;
  name: string;
  created_at: number;
  video_count: number;
}

export type QueueStatus = "queued" | "downloading" | "paused" | "done" | "failed" | "cancelled";

/** One row of the Downloads view, joined with its video and playlist. */
export interface QueueEntry {
  id: string;
  video_id: string;
  status: QueueStatus;
  /** 0 to 100. */
  progress: number;
  /** Bytes per second, as yt-dlp printed it. */
  speed: string | null;
  /** Seconds left, as yt-dlp printed it. */
  eta: string | null;
  /** Tail of yt-dlp's stderr when the download failed. */
  error: string | null;
  created_at: number;
  /** The Format it was queued with; null on rows from before that was stored. */
  format: string | null;
  title: string;
  url: string;
  source: string;
  playlist_id: string | null;
  playlist_title: string | null;
  playlist_index: number | null;
}

/** Payload of the `download-progress` event; patches a QueueEntry. */
export interface ProgressEvent {
  queue_id: string;
  status: QueueStatus;
  progress?: number;
  /** Always sent; null clears the previous value. */
  speed: string | null;
  eta: string | null;
  error?: string;
}

export interface EnqueueSummary {
  title: string;
  is_playlist: boolean;
  queued: number;
  skipped: number;
}

export interface Settings {
  download_dir: string;
  default_format: Format;
  concurrency: number;
  cookies_path: string | null;
}

export interface ToolchainReport {
  ytdlp_path: string | null;
  ytdlp_version: string | null;
  ffmpeg_path: string | null;
  deno_path: string | null;
}
