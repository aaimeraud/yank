//! Types that cross the IPC boundary. Every struct here has a twin in
//! `src/types.ts`; change both together.

use serde::{Deserialize, Serialize};

/// A library entry. A row exists as soon as a download is queued; `file_path`
/// is only set once the file is on disk.
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Video {
    /// The id yt-dlp reports for the media (a YouTube id, a tweet id...).
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    /// Seconds.
    pub duration: Option<i64>,
    pub thumbnail_path: Option<String>,
    /// The yt-dlp extractor name ("youtube", "twitter", "twitch:vod"...).
    /// The UI maps it to a brand; see `src/lib/source.ts`.
    pub source: String,
    pub url: String,
    pub file_path: Option<String>,
    /// Bytes.
    pub file_size: Option<i64>,
    /// Unix seconds.
    pub downloaded_at: Option<i64>,
    /// Seconds into the video where playback last stopped.
    pub last_position: i64,
    pub watched: bool,
    pub playlist_id: Option<String>,
    pub folder_id: Option<String>,
    /// 1-based position inside the playlist; None for a standalone video.
    pub playlist_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub video_count: i64,
}

/// Written by enqueue, never sent to the UI (so no twin in `src/types.ts`).
#[derive(Debug, Clone)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub source: String,
    pub url: String,
    pub thumbnail_path: Option<String>,
}

/// Lifecycle of a download. Stored as lowercase text in `queue_items.status`.
///
/// ```text
/// queued ──> downloading ──> done
///   ^  \          |  \
///   |   \         |   └──> failed ──(retry)──> queued
///   |    └──> paused <─┘
///   └──(resume)──┘          any active state ──(cancel)──> cancelled
/// ```
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[serde(rename_all = "lowercase")]
#[sqlx(type_name = "TEXT", rename_all = "lowercase")]
pub enum QueueStatus {
    Queued,
    Downloading,
    Paused,
    Done,
    Failed,
    Cancelled,
}

impl QueueStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Downloading => "downloading",
            Self::Paused => "paused",
            Self::Done => "done",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// What yt-dlp is asked to fetch. Stored as text in settings and on each
/// queue row. See ADR 0002 for why `Video` means H.264 MP4.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format {
    /// H.264 + AAC in MP4: plays inside the app on every Mac.
    #[default]
    Video,
    /// Audio only, M4A when the site offers it.
    Audio,
    /// Whatever yt-dlp ranks best. May be WebM/MKV that the player cannot open.
    Original,
    /// Above 1080p: YouTube has no H.264 there, so any codec is accepted.
    #[serde(rename = "2160p")]
    Max2160,
    #[serde(rename = "1440p")]
    Max1440,
    /// From here down, H.264 MP4 like `Video`, with a height limit.
    #[serde(rename = "1080p")]
    Max1080,
    #[serde(rename = "720p")]
    Max720,
    #[serde(rename = "480p")]
    Max480,
    #[serde(rename = "360p")]
    Max360,
}

impl Format {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Original => "original",
            Self::Max2160 => "2160p",
            Self::Max1440 => "1440p",
            Self::Max1080 => "1080p",
            Self::Max720 => "720p",
            Self::Max480 => "480p",
            Self::Max360 => "360p",
        }
    }

    /// Unknown or missing text falls back to the default instead of failing:
    /// a typo in the settings table must not block every download.
    pub fn parse(raw: Option<&str>) -> Self {
        match raw {
            Some("audio") => Self::Audio,
            Some("original") => Self::Original,
            Some("2160p") => Self::Max2160,
            Some("1440p") => Self::Max1440,
            Some("1080p") => Self::Max1080,
            Some("720p") => Self::Max720,
            Some("480p") => Self::Max480,
            Some("360p") => Self::Max360,
            _ => Self::Video,
        }
    }

    /// The height limit of a quality choice; None for the three kinds.
    pub fn max_height(self) -> Option<u32> {
        match self {
            Self::Max2160 => Some(2160),
            Self::Max1440 => Some(1440),
            Self::Max1080 => Some(1080),
            Self::Max720 => Some(720),
            Self::Max480 => Some(480),
            Self::Max360 => Some(360),
            Self::Video | Self::Audio | Self::Original => None,
        }
    }

    /// True for the choices that ask for H.264 and merge into an MP4.
    pub fn prefers_h264(self) -> bool {
        self == Self::Video || self.max_height().is_some_and(|height| height <= 1080)
    }
}

#[cfg(test)]
mod format_tests {
    use super::Format;

    #[test]
    fn every_format_survives_the_trip_through_the_database() {
        for format in [
            Format::Video,
            Format::Audio,
            Format::Original,
            Format::Max2160,
            Format::Max1440,
            Format::Max1080,
            Format::Max720,
            Format::Max480,
            Format::Max360,
        ] {
            assert_eq!(Format::parse(Some(format.as_str())), format);
            let wire = serde_json::to_string(&format).unwrap();
            assert_eq!(wire, format!("\"{}\"", format.as_str()));
        }
    }

    #[test]
    fn h264_is_asked_for_up_to_1080p_only() {
        assert!(Format::Video.prefers_h264());
        assert!(Format::Max1080.prefers_h264());
        assert!(!Format::Max1440.prefers_h264());
        assert!(!Format::Audio.prefers_h264());
        assert!(!Format::Original.prefers_h264());
    }
}

/// One way to download a URL (`QualityOption` in `src/types.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QualityOption {
    /// What to send back to `enqueue_url`.
    pub format: Format,
    pub label: String,
    /// Codec and container, as shown beside the label.
    pub detail: String,
    /// Bytes on disk; None when the site does not say.
    pub size: Option<i64>,
    /// The size is an estimate.
    pub approximate: bool,
    /// False when the built-in player may refuse the file (ADR 0002).
    pub plays_in_app: bool,
}

/// What `list_qualities` answers (`QualityChoice` in `src/types.ts`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct QualityChoice {
    pub title: String,
    pub is_playlist: bool,
    pub options: Vec<QualityOption>,
}

/// One row of the Downloads view: the queue item joined with what the UI
/// needs to label it, so the frontend never has to cross-reference lists.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct QueueEntry {
    pub id: String,
    pub video_id: String,
    pub status: QueueStatus,
    /// 0 to 100.
    pub progress: f64,
    /// Bytes per second as yt-dlp printed it, or None.
    pub speed: Option<String>,
    /// Seconds left as yt-dlp printed it, or None.
    pub eta: Option<String>,
    /// The tail of yt-dlp's stderr when the download failed.
    pub error: Option<String>,
    pub created_at: i64,
    pub format: Option<String>,
    pub title: String,
    pub url: String,
    pub source: String,
    pub playlist_id: Option<String>,
    pub playlist_title: Option<String>,
    pub playlist_index: Option<i64>,
}

/// One entry of what yt-dlp reports for a URL.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Metadata {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<i64>,
    pub thumbnail: Option<String>,
    pub extractor: Option<String>,
    pub webpage_url: Option<String>,
    /// 1-based position in the playlist, or 1 for a single video.
    pub index: i64,
    /// "is_live", "is_upcoming"... as yt-dlp reports it. A playlist download
    /// leaves live and upcoming entries out (`downloads::enqueue`).
    #[serde(default)]
    pub live_status: Option<String>,
}

/// What a pasted URL turned out to be.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UrlInfo {
    pub title: String,
    pub is_playlist: bool,
    pub entries: Vec<Metadata>,
}

/// The answer to "download this URL", so the UI can say what happened.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct EnqueueSummary {
    pub title: String,
    pub is_playlist: bool,
    /// Entries that got a new download.
    pub queued: usize,
    /// Entries already on disk or already in the queue.
    pub skipped: usize,
}

/// Payload of the `download-progress` event. It patches the row the UI
/// already holds: `progress` and `error` only when present, `speed` and
/// `eta` always.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProgressEvent {
    pub queue_id: String,
    pub status: QueueStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<f64>,
    /// Always sent, null included: a pause or a retry must clear the speed
    /// and ETA the UI still shows from the previous attempt.
    pub speed: Option<String>,
    pub eta: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ProgressEvent {
    pub fn status(queue_id: &str, status: QueueStatus) -> Self {
        Self {
            queue_id: queue_id.to_string(),
            status,
            progress: None,
            speed: None,
            eta: None,
            error: None,
        }
    }
}

/// External programs the app runs, as found on this machine.
#[derive(Debug, Clone, Serialize)]
pub struct ToolchainReport {
    pub ytdlp_path: Option<String>,
    pub ytdlp_version: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub deno_path: Option<String>,
}

/// What a YouTube search lists: videos or playlists. YouTube's own filter,
/// so each page holds only one kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchKind {
    Video,
    Playlist,
}

/// One search hit. `id` is the YouTube id (a video id is also the library's
/// `Video.id`, which is how the UI marks hits already downloaded).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchResult {
    pub kind: SearchKind,
    pub id: String,
    pub title: String,
    /// A watch URL or a playlist URL, ready for `enqueue_url`.
    pub url: String,
    pub channel: Option<String>,
    /// Seconds. None for live streams and playlists.
    pub duration: Option<i64>,
    pub view_count: Option<i64>,
    /// A web URL on i.ytimg.com, never a local path.
    pub thumbnail: Option<String>,
    /// "is_live", "is_upcoming", "was_live" or None, as yt-dlp reports it.
    pub live_status: Option<String>,
}

/// One page of search results.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SearchPage {
    pub results: Vec<SearchResult>,
    /// False once YouTube returned fewer results than asked for.
    pub has_more: bool,
}

/// How to stream a video without downloading it (ADR 0010).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Stream {
    /// An HLS master playlist (WKWebView plays it natively), or a direct
    /// file URL when the site offers no HLS.
    pub url: String,
    pub is_hls: bool,
    pub is_live: bool,
}
