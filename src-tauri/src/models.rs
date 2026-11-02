use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Video {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<i64>,
    pub thumbnail_path: Option<String>,
    pub source: String,
    pub url: String,
    pub file_path: Option<String>,
    pub file_size: Option<i64>,
    pub downloaded_at: Option<i64>,
    pub last_position: i64,
    pub watched: bool,
    pub playlist_id: Option<String>,
    pub folder_id: Option<String>,
    /// 1-based position inside the playlist; None for a standalone video.
    #[serde(default)]
    pub playlist_index: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub video_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub source: String,
    pub url: String,
    pub thumbnail_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueItem {
    pub id: String,
    pub video_id: Option<String>,
    pub status: String,
    pub progress: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub error: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Metadata {
    pub id: String,
    pub title: String,
    pub uploader: Option<String>,
    pub duration: Option<i64>,
    pub thumbnail: Option<String>,
    pub extractor: Option<String>,
    pub webpage_url: Option<String>,
    /// 1-based position in the playlist, or 1 for a single video.
    #[serde(default)]
    pub index: i64,
    /// Number of entries in the playlist, or 1 for a single video.
    #[serde(default)]
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistInfo {
    pub title: String,
    pub is_playlist: bool,
    pub entries: Vec<Metadata>,
}