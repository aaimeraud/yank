use crate::db::DbState;
use crate::download::{self, DownloadState};
use crate::models::{Metadata, Playlist, PlaylistInfo, Video};
use crate::util;
use serde_json::Value;
use sqlx::SqlitePool;
use tauri::Manager;

#[tauri::command]
pub async fn get_setting(state: tauri::State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(&key).fetch_optional(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(row.map(|r| r.0))
}

#[tauri::command]
pub async fn set_setting(state: tauri::State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(&key).bind(&value).execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn list_videos(state: tauri::State<'_, DbState>) -> Result<Vec<Video>, String> {
    let rows = sqlx::query_as::<_, (String, String, Option<String>, Option<i64>, Option<String>, String, String, Option<String>, Option<i64>, Option<i64>, i64, i64, Option<String>)>(
        "SELECT id, title, uploader, duration, thumbnail_path, source, url, file_path, file_size, downloaded_at, last_position, watched, playlist_id FROM videos ORDER BY downloaded_at DESC"
    ).fetch_all(&state.pool).await.map_err(|e| e.to_string())?;
    let mut videos = Vec::with_capacity(rows.len());
    for r in rows {
        let mut thumbnail = r.4;
        if thumbnail.is_none() {
            if let Some(fp) = &r.7 {
                if let Some(found) = util::find_thumbnail(fp) {
                    let _ = sqlx::query("UPDATE videos SET thumbnail_path=? WHERE id=?")
                        .bind(&found).bind(&r.0).execute(&state.pool).await;
                    thumbnail = Some(found);
                }
            }
        }
        videos.push(Video {
            id: r.0, title: r.1, uploader: r.2, duration: r.3, thumbnail_path: thumbnail, source: r.5, url: r.6,
            file_path: r.7, file_size: r.8, downloaded_at: r.9, last_position: r.10, watched: r.11 != 0, playlist_id: r.12,
        });
    }
    Ok(videos)
}

#[tauri::command]
pub async fn list_playlists(state: tauri::State<'_, DbState>) -> Result<Vec<Playlist>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, String, Option<String>)>(
        "SELECT id, title, source, url, thumbnail_path FROM playlists ORDER BY title"
    ).fetch_all(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| Playlist { id: r.0, title: r.1, source: r.2, url: r.3, thumbnail_path: r.4 }).collect())
}

#[tauri::command]
pub async fn list_queue(state: tauri::State<'_, DbState>) -> Result<Vec<crate::models::QueueItem>, String> {
    let rows = sqlx::query_as::<_, (String, Option<String>, String, f64, Option<String>, Option<String>, Option<String>, i64)>(
        "SELECT id, video_id, status, progress, speed, eta, error, created_at FROM queue_items ORDER BY created_at, rowid"
    ).fetch_all(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| crate::models::QueueItem { id: r.0, video_id: r.1, status: r.2, progress: r.3, speed: r.4, eta: r.5, error: r.6, created_at: r.7 }).collect())
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn fetch_metadata(url: String) -> Result<Metadata, String> {
    let ytdlp = util::find_ytdlp();
    let output = tokio::process::Command::new(&ytdlp).args(["--dump-json", "--no-playlist", &url]).output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let v: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|e| e.to_string())?;
    Ok(Metadata {
        id: v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        title: v.get("title").and_then(|x| x.as_str()).unwrap_or("Unknown").to_string(),
        uploader: v.get("uploader").and_then(|x| x.as_str()).map(|s| s.to_string()).or_else(|| v.get("channel").and_then(|x| x.as_str()).map(|s| s.to_string())),
        duration: v.get("duration").and_then(|x| x.as_i64()),
        thumbnail: v.get("thumbnail").and_then(|x| x.as_str()).map(|s| s.to_string()),
        extractor: v.get("extractor").and_then(|x| x.as_str()).map(|s| s.to_string()),
        webpage_url: v.get("webpage_url").and_then(|x| x.as_str()).map(|s| s.to_string()),
    })
}

fn thumbnail_of(v: &Value) -> Option<String> {
    if let Some(s) = v.get("thumbnail").and_then(|x| x.as_str()) {
        return Some(s.to_string());
    }
    v.get("thumbnails")
        .and_then(|x| x.as_array())
        .and_then(|a| a.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .map(|s| s.to_string())
}

fn uploader_of(v: &Value) -> Option<String> {
    for key in ["uploader", "channel", "creator"] {
        if let Some(s) = v.get(key).and_then(|x| x.as_str()) {
            return Some(s.to_string());
        }
    }
    v.get("creators")
        .and_then(|x| x.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.as_str())
        .map(|s| s.to_string())
}

fn extractor_of(v: &Value) -> Option<String> {
    v.get("extractor")
        .or_else(|| v.get("ie_key"))
        .or_else(|| v.get("extractor_key"))
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
}

fn normalize_url(v: &Value) -> Option<String> {
    if let Some(u) = v.get("webpage_url").and_then(|x| x.as_str()) {
        if u.starts_with("http") {
            return Some(u.to_string());
        }
    }
    if let Some(u) = v.get("url").and_then(|x| x.as_str()) {
        if u.starts_with("http") {
            return Some(u.to_string());
        }
        let extractor = extractor_of(v).unwrap_or_default().to_lowercase();
        if extractor.contains("youtube") && !u.is_empty() {
            return Some(format!("https://www.youtube.com/watch?v={u}"));
        }
        if !u.is_empty() {
            return Some(u.to_string());
        }
    }
    None
}

fn value_to_metadata(v: &Value) -> Metadata {
    Metadata {
        id: v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        title: v.get("title").and_then(|x| x.as_str()).unwrap_or("Unknown").to_string(),
        uploader: uploader_of(v),
        duration: v.get("duration").and_then(|x| x.as_f64()).map(|d| d as i64),
        thumbnail: thumbnail_of(v),
        extractor: extractor_of(v),
        webpage_url: normalize_url(v),
    }
}

fn parse_playlist_output(bytes: &[u8]) -> Result<PlaylistInfo, String> {
    let root: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    let is_playlist = root.get("_type").and_then(|x| x.as_str()) == Some("playlist")
        || root.get("entries").and_then(|x| x.as_array()).is_some();
    let entries: Vec<Metadata> = if is_playlist {
        root.get("entries")
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter(|e| !e.is_null())
                    .map(value_to_metadata)
                    .filter(|m| !m.id.is_empty() || m.webpage_url.is_some())
                    .collect()
            })
            .unwrap_or_default()
    } else {
        vec![value_to_metadata(&root)]
    };
    let title = root
        .get("title")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
        .or_else(|| entries.first().map(|e| e.title.clone()))
        .unwrap_or_else(|| "Playlist".to_string());
    Ok(PlaylistInfo { title, is_playlist, entries })
}

#[tauri::command]
pub async fn fetch_playlist_info(url: String) -> Result<PlaylistInfo, String> {
    let ytdlp = util::find_ytdlp();
    let output = tokio::process::Command::new(&ytdlp)
        .args(["--dump-single-json", "--flat-playlist", "--no-warnings", &url])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    parse_playlist_output(&output.stdout)
}

#[tauri::command]
pub async fn add_video(state: tauri::State<'_, DbState>, video: Video) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO videos (id, title, uploader, duration, thumbnail_path, source, url, file_path, file_size, downloaded_at, last_position, watched, playlist_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&video.id).bind(&video.title).bind(&video.uploader).bind(&video.duration).bind(&video.thumbnail_path)
        .bind(&video.source).bind(&video.url).bind(&video.file_path).bind(&video.file_size).bind(&video.downloaded_at)
        .bind(&video.last_position).bind(if video.watched {1i64} else {0i64}).bind(&video.playlist_id)
        .execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn upsert_playlist(pool: &SqlitePool, playlist: Playlist) -> Result<String, String> {
    // Re-adding the same playlist must reuse its row, or every video would point
    // at an id that was silently ignored by the unique url constraint.
    if let Some((id,)) = sqlx::query_as::<_, (String,)>("SELECT id FROM playlists WHERE url=?")
        .bind(&playlist.url)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
    {
        return Ok(id);
    }
    sqlx::query("INSERT INTO playlists (id, title, source, url, thumbnail_path) VALUES (?,?,?,?,?)")
        .bind(&playlist.id).bind(&playlist.title).bind(&playlist.source).bind(&playlist.url).bind(&playlist.thumbnail_path)
        .execute(pool).await.map_err(|e| e.to_string())?;
    Ok(playlist.id)
}

#[tauri::command]
pub async fn add_playlist(state: tauri::State<'_, DbState>, playlist: Playlist) -> Result<String, String> {
    upsert_playlist(&state.pool, playlist).await
}

#[tauri::command]
pub async fn start_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    downloads: tauri::State<'_, DownloadState>,
    video_id: String,
    url: String,
    format_pref: String,
    download_dir: String,
) -> Result<String, String> {
    download::start_download(
        app,
        state.pool.clone(),
        downloads.inner().clone(),
        video_id,
        url,
        format_pref,
        download_dir,
    )
    .await
}

#[tauri::command]
pub async fn cancel_download(
    state: tauri::State<'_, DbState>,
    downloads: tauri::State<'_, DownloadState>,
    queue_id: String,
) -> Result<(), String> {
    download::cancel_download(&state.pool, downloads.inner(), queue_id).await
}

#[tauri::command]
pub async fn pause_download(
    state: tauri::State<'_, DbState>,
    downloads: tauri::State<'_, DownloadState>,
    queue_id: String,
) -> Result<(), String> {
    download::pause_download(&state.pool, downloads.inner(), queue_id).await
}

#[tauri::command]
pub async fn resume_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    downloads: tauri::State<'_, DownloadState>,
    queue_id: String,
    format_pref: String,
    download_dir: String,
) -> Result<(), String> {
    download::resume_download(
        app,
        state.pool.clone(),
        downloads.inner().clone(),
        queue_id,
        format_pref,
        download_dir,
    )
    .await
}

#[tauri::command]
pub async fn remove_download(
    state: tauri::State<'_, DbState>,
    downloads: tauri::State<'_, DownloadState>,
    queue_id: String,
) -> Result<(), String> {
    download::remove_download(&state.pool, downloads.inner(), queue_id).await
}

#[tauri::command]
pub async fn clear_finished_downloads(state: tauri::State<'_, DbState>) -> Result<(), String> {
    download::clear_finished_downloads(&state.pool).await
}

#[tauri::command]
pub async fn update_playback(state: tauri::State<'_, DbState>, video_id: String, position: i64, watched: bool) -> Result<(), String> {
    sqlx::query("UPDATE videos SET last_position=?, watched=? WHERE id=?")
        .bind(position).bind(if watched {1i64} else {0i64}).bind(&video_id)
        .execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_playlist_with_absolute_entry_urls() {
        let json = br#"{
          "_type":"playlist","title":"My List","entries":[
            {"_type":"url","ie_key":"Youtube","id":"abc123","url":"https://www.youtube.com/watch?v=abc123","title":"One","duration":61,"thumbnails":[{"url":"https://img/1.jpg"}]},
            {"_type":"url","ie_key":"Youtube","id":"def456","url":"https://www.youtube.com/watch?v=def456","title":"Two","duration":62.5}
          ]}"#;
        let info = parse_playlist_output(json).unwrap();
        assert!(info.is_playlist);
        assert_eq!(info.title, "My List");
        assert_eq!(info.entries.len(), 2);
        assert_eq!(info.entries[0].webpage_url.as_deref(), Some("https://www.youtube.com/watch?v=abc123"));
        assert_eq!(info.entries[0].thumbnail.as_deref(), Some("https://img/1.jpg"));
        assert_eq!(info.entries[1].duration, Some(62));
        assert_eq!(info.entries[1].extractor.as_deref(), Some("Youtube"));
    }

    #[test]
    fn expands_bare_youtube_ids() {
        let json = br#"{"_type":"url","ie_key":"Youtube","id":"abc123","url":"abc123","title":"Bare"}"#;
        let info = parse_playlist_output(json).unwrap();
        assert!(!info.is_playlist);
        assert_eq!(info.entries.len(), 1);
        assert_eq!(
            info.entries[0].webpage_url.as_deref(),
            Some("https://www.youtube.com/watch?v=abc123")
        );
    }

    #[test]
    fn single_video_is_not_a_playlist() {
        let json = br#"{"_type":"video","id":"v1","title":"Solo","webpage_url":"https://example.com/v1","extractor":"generic"}"#;
        let info = parse_playlist_output(json).unwrap();
        assert!(!info.is_playlist);
        assert_eq!(info.title, "Solo");
        assert_eq!(info.entries.len(), 1);
        assert_eq!(info.entries[0].webpage_url.as_deref(), Some("https://example.com/v1"));
    }

    #[test]
    fn skips_empty_playlist_entries_and_falls_back_to_first_title() {
        let json = br#"{"_type":"playlist","entries":[null,{"_type":"url","id":"x","title":"Only","url":"https://example.com/x"}]}"#;
        let info = parse_playlist_output(json).unwrap();
        assert_eq!(info.entries.len(), 1);
        assert_eq!(info.title, "Only");
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_playlist_extraction() {
        let info = fetch_playlist_info("https://www.youtube.com/@RickAstleyYT/videos".to_string())
            .await
            .unwrap();
        assert!(info.is_playlist);
        assert!(info.entries.len() > 1);
        assert!(info.entries.iter().all(|e| {
            e.webpage_url.as_deref().map(|u| u.starts_with("http")).unwrap_or(false)
        }));
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_single_video_is_not_playlist() {
        let info = fetch_playlist_info("https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string())
            .await
            .unwrap();
        assert!(!info.is_playlist);
        assert_eq!(info.entries.len(), 1);
    }

    async fn test_pool() -> SqlitePool {
        use sqlx::sqlite::SqlitePoolOptions;
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn playlist(id: &str) -> Playlist {
        Playlist {
            id: id.to_string(),
            title: "List".to_string(),
            source: "Youtube".to_string(),
            url: "https://example.com/list".to_string(),
            thumbnail_path: None,
        }
    }

    #[tokio::test]
    async fn add_playlist_reuses_the_existing_row() {
        let pool = test_pool().await;
        assert_eq!(upsert_playlist(&pool, playlist("p1")).await.unwrap(), "p1");
        assert_eq!(upsert_playlist(&pool, playlist("p2")).await.unwrap(), "p1");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlists")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 1);
    }
}
