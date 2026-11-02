use crate::db::DbState;
use crate::download::{self, DownloadState};
use crate::models::{Folder, Metadata, Playlist, PlaylistInfo, Video};
use crate::util;
use serde_json::Value;
use sqlx::SqlitePool;

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
    let rows = sqlx::query_as::<_, (String, String, Option<String>, Option<i64>, Option<String>, String, String, Option<String>, Option<i64>, Option<i64>, i64, i64, Option<String>, Option<String>)>(
        "SELECT id, title, uploader, duration, thumbnail_path, source, url, file_path, file_size, downloaded_at, last_position, watched, playlist_id, folder_id FROM videos ORDER BY downloaded_at DESC"
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
            folder_id: r.13,
        });
    }
    Ok(videos)
}

fn folder_name(raw: &str) -> Result<String, String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err("Folder name cannot be empty.".to_string());
    }
    if name.chars().count() > 60 {
        return Err("Folder name is limited to 60 characters.".to_string());
    }
    Ok(name.to_string())
}

async fn list_folders_for(pool: &SqlitePool) -> Result<Vec<Folder>, String> {
    let rows = sqlx::query_as::<_, (String, String, i64, i64)>(
        "SELECT f.id, f.name, f.created_at, COUNT(v.id) \
         FROM folders f LEFT JOIN videos v ON v.folder_id = f.id \
         GROUP BY f.id, f.name, f.created_at \
         ORDER BY f.name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| Folder {
            id: r.0,
            name: r.1,
            created_at: r.2,
            video_count: r.3,
        })
        .collect())
}

async fn create_folder_for(pool: &SqlitePool, raw_name: &str) -> Result<Folder, String> {
    let name = folder_name(raw_name)?;
    let id = uuid::Uuid::new_v4().to_string();
    let created_at = chrono::Utc::now().timestamp();
    sqlx::query("INSERT INTO folders (id, name, created_at) VALUES (?,?,?)")
        .bind(&id)
        .bind(&name)
        .bind(created_at)
        .execute(pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                format!("A folder named \"{name}\" already exists.")
            }
            _ => e.to_string(),
        })?;
    Ok(Folder {
        id,
        name,
        created_at,
        video_count: 0,
    })
}

async fn rename_folder_for(pool: &SqlitePool, id: &str, raw_name: &str) -> Result<(), String> {
    let name = folder_name(raw_name)?;
    let result = sqlx::query("UPDATE folders SET name=? WHERE id=?")
        .bind(&name)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| match &e {
            sqlx::Error::Database(db) if db.is_unique_violation() => {
                format!("A folder named \"{name}\" already exists.")
            }
            _ => e.to_string(),
        })?;
    if result.rows_affected() == 0 {
        return Err("Folder not found.".to_string());
    }
    Ok(())
}

async fn delete_folder_for(pool: &SqlitePool, id: &str) -> Result<(), String> {
    // SQLite only honours ON DELETE SET NULL with foreign keys enabled, and the
    // pool does not turn them on, so unfiling is explicit.
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    sqlx::query("UPDATE videos SET folder_id=NULL WHERE folder_id=?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let result = sqlx::query("DELETE FROM folders WHERE id=?")
        .bind(id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("Folder not found.".to_string());
    }
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn move_video_for(
    pool: &SqlitePool,
    video_id: &str,
    folder_id: Option<&str>,
) -> Result<(), String> {
    if let Some(folder) = folder_id {
        let exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM folders WHERE id=?")
            .bind(folder)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
        if exists.is_none() {
            return Err("Folder not found.".to_string());
        }
    }
    let result = sqlx::query("UPDATE videos SET folder_id=? WHERE id=?")
        .bind(folder_id)
        .bind(video_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    if result.rows_affected() == 0 {
        return Err("Video not found.".to_string());
    }
    Ok(())
}

async fn remove_video_for(pool: &SqlitePool, video_id: &str, delete_file: bool) -> Result<(), String> {
    let row: Option<(Option<String>, Option<String>)> =
        sqlx::query_as("SELECT file_path, thumbnail_path FROM videos WHERE id=?")
            .bind(video_id)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;
    let (file_path, thumbnail_path) = row.ok_or_else(|| "Video not found.".to_string())?;

    // A queued or running download owns its queue row; deleting it here would
    // orphan the yt-dlp process with no way left to cancel it.
    let active: Option<(i64,)> = sqlx::query_as(
        "SELECT 1 FROM queue_items WHERE video_id=? AND status IN ('queued','downloading')",
    )
    .bind(video_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    if active.is_some() {
        return Err("Cancel this download in Downloads before removing the video.".to_string());
    }

    // The queue foreign key cascades only with foreign keys enabled, so clear the
    // rows explicitly or a removed video leaves a dead entry in Downloads.
    sqlx::query("DELETE FROM queue_items WHERE video_id=?")
        .bind(video_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM videos WHERE id=?")
        .bind(video_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    if delete_file {
        for path in [file_path, thumbnail_path].into_iter().flatten() {
            match std::fs::remove_file(&path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => return Err(format!("Removed the entry, but could not delete {path}: {e}")),
            }
        }
    }
    Ok(())
}

async fn ensure_playlist_folder_for(
    pool: &SqlitePool,
    playlist_id: &str,
    entry_ids: &[String],
) -> Result<String, String> {
    let title: Option<(String,)> = sqlx::query_as("SELECT title FROM playlists WHERE id=?")
        .bind(playlist_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    let title = title.ok_or_else(|| "Playlist not found.".to_string())?.0;

    let trimmed = title.trim();
    let source = if trimmed.is_empty() { "Playlist" } else { trimmed };
    let name: String = source.chars().take(60).collect();
    let name = name.trim().to_string();

    let existing: Option<(String,)> =
        sqlx::query_as("SELECT id FROM folders WHERE name = ? COLLATE NOCASE")
            .bind(&name)
            .fetch_optional(pool)
            .await
            .map_err(|e| e.to_string())?;

    let folder_id = match existing {
        Some((id,)) => id,
        None => {
            let id = uuid::Uuid::new_v4().to_string();
            let result = sqlx::query("INSERT INTO folders (id, name, created_at) VALUES (?,?,?)")
                .bind(&id)
                .bind(&name)
                .bind(chrono::Utc::now().timestamp())
                .execute(pool)
                .await;
            match result {
                Ok(_) => id,
                Err(sqlx::Error::Database(db)) if db.is_unique_violation() => {
                    sqlx::query_scalar::<_, String>(
                        "SELECT id FROM folders WHERE name = ? COLLATE NOCASE",
                    )
                    .bind(&name)
                    .fetch_one(pool)
                    .await
                    .map_err(|e| e.to_string())?
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    };

    // Only unfiled videos join the folder, so re-downloading a playlist never
    // pulls videos the user has already organized somewhere else.
    sqlx::query("UPDATE videos SET folder_id=? WHERE playlist_id=? AND folder_id IS NULL")
        .bind(&folder_id)
        .bind(playlist_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    // A video downloaded on its own before the playlist existed has no
    // playlist_id, so the update above misses it. Adopt it by id instead, and
    // record the playlist link now that we know where it belongs.
    for chunk in entry_ids.chunks(400) {
        let placeholders = vec!["?"; chunk.len()].join(",");
        let sql = format!(
            "UPDATE videos SET folder_id=?, playlist_id=COALESCE(playlist_id, ?) \
             WHERE id IN ({placeholders}) AND folder_id IS NULL"
        );
        let mut query = sqlx::query(&sql).bind(&folder_id).bind(playlist_id);
        for id in chunk {
            query = query.bind(id);
        }
        query.execute(pool).await.map_err(|e| e.to_string())?;
    }

    Ok(folder_id)
}

#[tauri::command]
pub async fn ensure_playlist_folder(
    state: tauri::State<'_, DbState>,
    playlist_id: String,
    entry_ids: Vec<String>,
) -> Result<String, String> {
    ensure_playlist_folder_for(&state.pool, &playlist_id, &entry_ids).await
}

#[tauri::command]
pub async fn prune_missing_videos(
    state: tauri::State<'_, DbState>,
    ids: Vec<String>,
) -> Result<Vec<String>, String> {
    crate::db::clear_missing_files(&state.pool, &ids).await
}

#[tauri::command]
pub async fn list_folders(state: tauri::State<'_, DbState>) -> Result<Vec<Folder>, String> {
    list_folders_for(&state.pool).await
}

#[tauri::command]
pub async fn create_folder(state: tauri::State<'_, DbState>, name: String) -> Result<Folder, String> {
    create_folder_for(&state.pool, &name).await
}

#[tauri::command]
pub async fn rename_folder(
    state: tauri::State<'_, DbState>,
    id: String,
    name: String,
) -> Result<(), String> {
    rename_folder_for(&state.pool, &id, &name).await
}

#[tauri::command]
pub async fn delete_folder(state: tauri::State<'_, DbState>, id: String) -> Result<(), String> {
    delete_folder_for(&state.pool, &id).await
}

#[tauri::command]
pub async fn move_video(
    state: tauri::State<'_, DbState>,
    video_id: String,
    folder_id: Option<String>,
) -> Result<(), String> {
    move_video_for(&state.pool, &video_id, folder_id.as_deref()).await
}

#[tauri::command]
pub async fn remove_video(
    state: tauri::State<'_, DbState>,
    video_id: String,
    delete_file: bool,
) -> Result<(), String> {
    remove_video_for(&state.pool, &video_id, delete_file).await
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
pub async fn pick_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let file = app
        .dialog()
        .file()
        .add_filter("Cookies", &["txt"])
        .blocking_pick_file();
    Ok(file.map(|p| p.to_string()))
}

#[tauri::command]
pub async fn ytdlp_version() -> Result<String, String> {
    let output = tokio::process::Command::new(util::find_ytdlp())
        .arg("--version")
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

async fn cookies_for(pool: &SqlitePool) -> Option<String> {
    crate::db::setting(pool, "cookies_path").await
}

#[tauri::command]
pub async fn fetch_metadata(state: tauri::State<'_, DbState>, url: String) -> Result<Metadata, String> {
    let ytdlp = util::find_ytdlp();
    let mut cmd = tokio::process::Command::new(&ytdlp);
    cmd.args(["--dump-json", "--no-playlist", &url]);
    if let Some(cookies) = cookies_for(&state.pool).await {
        cmd.args(["--cookies", &cookies]);
    }
    let output = cmd.output().await.map_err(|e| e.to_string())?;
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

async fn fetch_playlist_info_with(url: &str, cookies: Option<&str>) -> Result<PlaylistInfo, String> {
    let ytdlp = util::find_ytdlp();
    let mut cmd = tokio::process::Command::new(&ytdlp);
    cmd.args(["--dump-single-json", "--flat-playlist", "--no-warnings", url]);
    if let Some(cookies) = cookies {
        cmd.args(["--cookies", cookies]);
    }
    let output = cmd.output().await.map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    parse_playlist_output(&output.stdout)
}

#[tauri::command]
pub async fn fetch_playlist_info(
    state: tauri::State<'_, DbState>,
    url: String,
) -> Result<PlaylistInfo, String> {
    let cookies = cookies_for(&state.pool).await;
    fetch_playlist_info_with(&url, cookies.as_deref()).await
}

#[tauri::command]
pub async fn add_video(state: tauri::State<'_, DbState>, video: Video) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO videos (id, title, uploader, duration, thumbnail_path, source, url, file_path, file_size, downloaded_at, last_position, watched, playlist_id, folder_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&video.id).bind(&video.title).bind(&video.uploader).bind(&video.duration).bind(&video.thumbnail_path)
        .bind(&video.source).bind(&video.url).bind(&video.file_path).bind(&video.file_size).bind(&video.downloaded_at)
        .bind(&video.last_position).bind(if video.watched {1i64} else {0i64}).bind(&video.playlist_id)
        .bind(&video.folder_id)
        .execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

async fn upsert_playlist(pool: &SqlitePool, playlist: Playlist) -> Result<String, String> {
    // Re-adding the same playlist must reuse its row, or every video would point
    // at an id that was silently ignored by the unique url constraint. The
    // metadata still refreshes: a renamed playlist should file new downloads
    // under the name the user sees today.
    if let Some((id,)) = sqlx::query_as::<_, (String,)>("SELECT id FROM playlists WHERE url=?")
        .bind(&playlist.url)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?
    {
        sqlx::query(
            "UPDATE playlists SET title=?, source=?, thumbnail_path=COALESCE(?, thumbnail_path) WHERE id=?",
        )
        .bind(&playlist.title)
        .bind(&playlist.source)
        .bind(&playlist.thumbnail_path)
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
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
        let info = fetch_playlist_info_with("https://www.youtube.com/@RickAstleyYT/videos", None)
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
        let info = fetch_playlist_info_with("https://www.youtube.com/watch?v=dQw4w9WgXcQ", None)
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

        let mut renamed = playlist("p2");
        renamed.title = "Renamed list".to_string();
        renamed.source = "Vimeo".to_string();
        assert_eq!(upsert_playlist(&pool, renamed).await.unwrap(), "p1");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM playlists")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count.0, 1);

        let (title, source): (String, String) =
            sqlx::query_as("SELECT title, source FROM playlists WHERE id='p1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title, "Renamed list");
        assert_eq!(source, "Vimeo");
    }

    async fn insert_video_row(pool: &SqlitePool, id: &str, folder_id: Option<&str>) {
        insert_video_row_at(pool, id, folder_id, &format!("/tmp/{id}.mp4")).await;
    }

    async fn insert_video_row_at(
        pool: &SqlitePool,
        id: &str,
        folder_id: Option<&str>,
        file_path: &str,
    ) {
        sqlx::query(
            "INSERT INTO videos (id, title, source, url, file_path, last_position, watched, folder_id) \
             VALUES (?,?,?,?,?,0,0,?)",
        )
        .bind(id)
        .bind(format!("Video {id}"))
        .bind("Youtube")
        .bind(format!("https://example.com/{id}"))
        .bind(file_path)
        .bind(folder_id)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn folder_id_of(pool: &SqlitePool, video_id: &str) -> Option<String> {
        sqlx::query_scalar::<_, Option<String>>("SELECT folder_id FROM videos WHERE id=?")
            .bind(video_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    async fn playlist_id_of(pool: &SqlitePool, video_id: &str) -> Option<String> {
        sqlx::query_scalar::<_, Option<String>>("SELECT playlist_id FROM videos WHERE id=?")
            .bind(video_id)
            .fetch_one(pool)
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn folders_trim_names_and_reject_duplicates() {
        let pool = test_pool().await;

        assert!(create_folder_for(&pool, "   ").await.is_err());
        let folder = create_folder_for(&pool, "  Watch later  ").await.unwrap();
        assert_eq!(folder.name, "Watch later");
        assert_eq!(folder.video_count, 0);

        let duplicate = create_folder_for(&pool, "watch LATER").await.unwrap_err();
        assert!(duplicate.contains("already exists"), "{duplicate}");

        assert_eq!(list_folders_for(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn renaming_a_folder_keeps_names_unique() {
        let pool = test_pool().await;
        let first = create_folder_for(&pool, "Music").await.unwrap();
        let second = create_folder_for(&pool, "Talks").await.unwrap();

        let clash = rename_folder_for(&pool, &second.id, " music ").await.unwrap_err();
        assert!(clash.contains("already exists"), "{clash}");

        rename_folder_for(&pool, &second.id, "  Long talks ").await.unwrap();
        let names: Vec<String> = list_folders_for(&pool)
            .await
            .unwrap()
            .into_iter()
            .map(|f| f.name)
            .collect();
        assert_eq!(names, vec!["Long talks", "Music"]);
        assert!(rename_folder_for(&pool, &first.id, "").await.is_err());
        assert!(rename_folder_for(&pool, "missing", "Any").await.is_err());
    }

    #[tokio::test]
    async fn deleting_a_folder_unfiles_its_videos() {
        let pool = test_pool().await;
        let folder = create_folder_for(&pool, "Keepers").await.unwrap();
        insert_video_row(&pool, "v1", Some(&folder.id)).await;
        insert_video_row(&pool, "v2", None).await;

        assert_eq!(list_folders_for(&pool).await.unwrap()[0].video_count, 1);

        delete_folder_for(&pool, &folder.id).await.unwrap();
        assert!(list_folders_for(&pool).await.unwrap().is_empty());
        assert_eq!(folder_id_of(&pool, "v1").await, None);
        assert_eq!(folder_id_of(&pool, "v2").await, None);

        let videos: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM videos")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(videos.0, 2);
        assert!(delete_folder_for(&pool, &folder.id).await.is_err());
    }

    #[tokio::test]
    async fn moving_videos_updates_folder_counts() {
        let pool = test_pool().await;
        let folder = create_folder_for(&pool, "Research").await.unwrap();
        insert_video_row(&pool, "v1", None).await;

        move_video_for(&pool, "v1", Some(&folder.id)).await.unwrap();
        assert_eq!(folder_id_of(&pool, "v1").await.as_deref(), Some(folder.id.as_str()));
        assert_eq!(list_folders_for(&pool).await.unwrap()[0].video_count, 1);

        move_video_for(&pool, "v1", None).await.unwrap();
        assert_eq!(folder_id_of(&pool, "v1").await, None);
        assert_eq!(list_folders_for(&pool).await.unwrap()[0].video_count, 0);

        assert!(move_video_for(&pool, "v1", Some("nope")).await.is_err());
        assert!(move_video_for(&pool, "missing", None).await.is_err());
    }

    #[tokio::test]
    async fn removing_a_video_keeps_or_deletes_the_file() {
        let pool = test_pool().await;
        let dir = std::env::temp_dir().join(format!("yank-remove-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let kept = dir.join("kept.mp4");
        let deleted = dir.join("deleted.mp4");
        std::fs::write(&kept, b"x").unwrap();
        std::fs::write(&deleted, b"x").unwrap();

        insert_video_row_at(&pool, "kept", None, &kept.to_string_lossy()).await;
        insert_video_row_at(&pool, "deleted", None, &deleted.to_string_lossy()).await;
        for id in ["kept", "deleted"] {
            sqlx::query(
                "INSERT INTO queue_items (id, video_id, status, progress, created_at) VALUES (?,?, 'done', 100, 0)",
            )
            .bind(format!("q-{id}"))
            .bind(id)
            .execute(&pool)
            .await
            .unwrap();
        }

        remove_video_for(&pool, "kept", false).await.unwrap();
        assert!(kept.exists());
        remove_video_for(&pool, "deleted", true).await.unwrap();
        assert!(!deleted.exists());
        assert!(remove_video_for(&pool, "kept", false).await.is_err());

        insert_video_row(&pool, "busy", None).await;
        sqlx::query(
            "INSERT INTO queue_items (id, video_id, status, created_at) VALUES ('q-busy','busy','downloading',0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let blocked = remove_video_for(&pool, "busy", false).await.unwrap_err();
        assert!(blocked.contains("Cancel this download"), "{blocked}");
        assert_eq!(folder_id_of(&pool, "busy").await, None);

        let videos: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM videos")
            .fetch_one(&pool)
            .await
            .unwrap();
        let queue: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM queue_items")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(videos.0, 1);
        assert_eq!(queue.0, 1);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn playlist_folders_adopt_standalone_videos_but_never_manual_ones() {
        let pool = test_pool().await;
        let mut list = playlist("p1");
        list.title = "  My Playlist  ".to_string();
        upsert_playlist(&pool, list).await.unwrap();
        let keepers = create_folder_for(&pool, "Keepers").await.unwrap();

        // "linked" already belongs to the playlist, "standalone" was downloaded
        // on its own before the playlist existed (so it has no playlist_id),
        // and "filed" was moved into a user folder that must be respected.
        insert_video_row(&pool, "linked", None).await;
        insert_video_row(&pool, "standalone", None).await;
        insert_video_row(&pool, "filed", Some(&keepers.id)).await;
        sqlx::query("UPDATE videos SET playlist_id='p1' WHERE id='linked'")
            .execute(&pool)
            .await
            .unwrap();

        let entries = vec![
            "linked".to_string(),
            "standalone".to_string(),
            "filed".to_string(),
        ];
        let folder_id = ensure_playlist_folder_for(&pool, "p1", &entries).await.unwrap();
        let (name,): (String,) = sqlx::query_as("SELECT name FROM folders WHERE id=?")
            .bind(&folder_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "My Playlist");
        assert_eq!(
            folder_id_of(&pool, "linked").await.as_deref(),
            Some(folder_id.as_str())
        );
        assert_eq!(
            folder_id_of(&pool, "standalone").await.as_deref(),
            Some(folder_id.as_str())
        );
        assert_eq!(
            playlist_id_of(&pool, "standalone").await.as_deref(),
            Some("p1")
        );
        assert_eq!(
            folder_id_of(&pool, "filed").await.as_deref(),
            Some(keepers.id.as_str())
        );

        // Re-adding the playlist must reuse the same folder and change nothing.
        assert_eq!(
            ensure_playlist_folder_for(&pool, "p1", &entries).await.unwrap(),
            folder_id
        );
        let folders: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM folders")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(folders.0, 2);
        assert!(ensure_playlist_folder_for(&pool, "missing", &[]).await.is_err());
    }

    #[tokio::test]
    async fn playlist_folders_link_standalone_rows_without_a_folder() {
        let pool = test_pool().await;
        upsert_playlist(&pool, playlist("p1")).await.unwrap();
        insert_video_row(&pool, "solo", None).await;

        let folder_id = ensure_playlist_folder_for(&pool, "p1", &["solo".to_string()])
            .await
            .unwrap();
        assert_eq!(
            folder_id_of(&pool, "solo").await.as_deref(),
            Some(folder_id.as_str())
        );
        assert_eq!(playlist_id_of(&pool, "solo").await.as_deref(), Some("p1"));
    }

    #[tokio::test]
    async fn playlist_folder_names_are_truncated_and_defaulted() {
        let pool = test_pool().await;
        upsert_playlist(&pool, playlist("p1")).await.unwrap();

        sqlx::query("UPDATE playlists SET title=? WHERE id='p1'")
            .bind("x".repeat(80))
            .execute(&pool)
            .await
            .unwrap();
        let folder_id = ensure_playlist_folder_for(&pool, "p1", &[]).await.unwrap();
        let (name,): (String,) = sqlx::query_as("SELECT name FROM folders WHERE id=?")
            .bind(&folder_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name.chars().count(), 60);

        sqlx::query("UPDATE playlists SET title='   ' WHERE id='p1'")
            .execute(&pool)
            .await
            .unwrap();
        let folder_id = ensure_playlist_folder_for(&pool, "p1", &[]).await.unwrap();
        let (name,): (String,) = sqlx::query_as("SELECT name FROM folders WHERE id=?")
            .bind(&folder_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(name, "Playlist");
    }
}
