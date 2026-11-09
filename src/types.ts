// Mirrors of the Rust types in src-tauri/src/models.rs and settings.rs.
// Change both sides together.

/** The screen in the main area. "player" is the full-size player. */
export type View = "library" | "youtube" | "downloads" | "settings" | "player";

/** What yt-dlp is asked for. See ADR 0002. */
export type Format = "video" | "audio" | "original" | "2160p" | "1440p" | "1080p" | "720p" | "480p" | "360p";

/** One way to download a URL (`QualityOption` in models.rs). */
export interface QualityOption {
  format: Format;
  label: string;
  /** Codec and container. */
  detail: string;
  /** Bytes on disk; null when the site does not say. */
  size: number | null;
  /** The size is an estimate. */
  approximate: boolean;
  /** False when the built-in player may refuse the file. */
  plays_in_app: boolean;
}

export interface QualityChoice {
  title: string;
  is_playlist: boolean;
  options: QualityOption[];
}

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

/** What a YouTube search lists. */
export type SearchKind = "video" | "playlist";

/** One YouTube search hit (`SearchResult` in models.rs). */
export interface SearchResult {
  kind: SearchKind;
  /** The YouTube id; for a video, also its library `Video.id`. */
  id: string;
  title: string;
  /** Watch or playlist URL, ready for `enqueueUrl`. */
  url: string;
  channel: string | null;
  /** Seconds; null for live streams and playlists. */
  duration: number | null;
  view_count: number | null;
  /** A web URL (i.ytimg.com), never a local path. */
  thumbnail: string | null;
  /** "is_live", "is_upcoming", "was_live" or null. */
  live_status: string | null;
}

export interface SearchPage {
  results: SearchResult[];
  has_more: boolean;
}

/** Where to stream a video from (ADR 0010). Expires after a few hours. */
export interface Stream {
  url: string;
  /** An HLS master playlist, which WKWebView plays natively. */
  is_hls: boolean;
  is_live: boolean;
}

/** One entry of what yt-dlp reports for a URL (`Metadata` in models.rs). */
export interface Metadata {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  /** A web URL here, not a local path. */
  thumbnail: string | null;
  extractor: string | null;
  webpage_url: string | null;
  index: number;
  /** "is_live", "is_upcoming"... or null. */
  live_status: string | null;
}

/** What a URL turned out to be (`UrlInfo` in models.rs). */
export interface UrlInfo {
  title: string;
  is_playlist: boolean;
  entries: Metadata[];
}
