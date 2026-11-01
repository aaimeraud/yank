use crate::db::DbState;
use crate::download;
use crate::models::{Metadata, Playlist, Video};
use crate::util;
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
    Ok(rows.into_iter().map(|r| Video {
        id: r.0, title: r.1, uploader: r.2, duration: r.3, thumbnail_path: r.4, source: r.5, url: r.6,
        file_path: r.7, file_size: r.8, downloaded_at: r.9, last_position: r.10, watched: r.11 != 0, playlist_id: r.12,
    }).collect())
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
        "SELECT id, video_id, status, progress, speed, eta, error, created_at FROM queue_items ORDER BY created_at"
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

#[tauri::command]
pub async fn fetch_playlist_entries(url: String) -> Result<Vec<Metadata>, String> {
    let ytdlp = util::find_ytdlp();
    let output = tokio::process::Command::new(&ytdlp).args(["--flat-playlist", "--dump-json", &url]).output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    let mut entries = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if line.trim().is_empty() { continue; }
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            entries.push(Metadata {
                id: v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string(),
                title: v.get("title").and_then(|x| x.as_str()).unwrap_or("Unknown").to_string(),
                uploader: v.get("uploader").and_then(|x| x.as_str()).map(|s| s.to_string()).or_else(|| v.get("channel").and_then(|x| x.as_str()).map(|s| s.to_string())),
                duration: v.get("duration").and_then(|x| x.as_i64()),
                thumbnail: v.get("thumbnail").and_then(|x| x.as_str()).map(|s| s.to_string()),
                extractor: v.get("extractor").and_then(|x| x.as_str()).map(|s| s.to_string()),
                webpage_url: v.get("url").and_then(|x| x.as_str()).map(|s| s.to_string()).or_else(|| v.get("webpage_url").and_then(|x| x.as_str()).map(|s| s.to_string())),
            });
        }
    }
    Ok(entries)
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

#[tauri::command]
pub async fn add_playlist(state: tauri::State<'_, DbState>, playlist: Playlist) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO playlists (id, title, source, url, thumbnail_path) VALUES (?,?,?,?,?)")
        .bind(&playlist.id).bind(&playlist.title).bind(&playlist.source).bind(&playlist.url).bind(&playlist.thumbnail_path)
        .execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command(name = "start_download")]
pub async fn start_download_cmd(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    video_id: String,
    url: String,
    format_pref: String,
    download_dir: String,
) -> Result<String, String> {
    download::start_download(app, state.pool.clone(), video_id, url, format_pref, download_dir).await
}

#[tauri::command(name = "cancel_download")]
pub async fn cancel_download_cmd(state: tauri::State<'_, DbState>, queue_id: String) -> Result<(), String> {
    download::cancel_download(&state.pool, queue_id).await
}