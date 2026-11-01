use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use sqlx::migrate::MigrateDatabase;
use sqlx::Sqlite;
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

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
}

pub struct DbState {
    pub pool: SqlitePool,
}

fn db_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("yank.db")
}

pub async fn init_db(app: &tauri::AppHandle) -> SqlitePool {
    let path = db_path(app);
    let url = format!("sqlite:{}", path.display());
    if !Sqlite::database_exists(&url).await.unwrap_or(false) {
        Sqlite::create_database(&url).await.expect("create db");
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .expect("connect db");
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("migrate");
    pool
}

fn find_ytdlp() -> String {
    if let Ok(p) = std::env::var("YTDLP_PATH") { if std::path::Path::new(&p).exists() { return p; } }
    let home = std::env::var("HOME").unwrap_or_default();
    let mut candidates = vec!["yt-dlp".to_string(), format!("{}/.local/bin/yt-dlp", home), "/opt/homebrew/bin/yt-dlp".to_string(), "/usr/local/bin/yt-dlp".to_string(), "/usr/bin/yt-dlp".to_string()];
    for c in candidates {
        if std::process::Command::new(&c).arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
            return c;
        }
    }
    "yt-dlp".to_string()
}

#[tauri::command]
async fn get_setting(state: tauri::State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(&key).fetch_optional(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(row.map(|r| r.0))
}

#[tauri::command]
async fn set_setting(state: tauri::State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(&key).bind(&value).execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn list_videos(state: tauri::State<'_, DbState>) -> Result<Vec<Video>, String> {
    let rows = sqlx::query_as::<_, (String, String, Option<String>, Option<i64>, Option<String>, String, String, Option<String>, Option<i64>, Option<i64>, i64, i64, Option<String>)>(
        "SELECT id, title, uploader, duration, thumbnail_path, source, url, file_path, file_size, downloaded_at, last_position, watched, playlist_id FROM videos ORDER BY downloaded_at DESC"
    ).fetch_all(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| Video {
        id: r.0, title: r.1, uploader: r.2, duration: r.3, thumbnail_path: r.4, source: r.5, url: r.6,
        file_path: r.7, file_size: r.8, downloaded_at: r.9, last_position: r.10, watched: r.11 != 0, playlist_id: r.12,
    }).collect())
}

#[tauri::command]
async fn list_playlists(state: tauri::State<'_, DbState>) -> Result<Vec<Playlist>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, String, Option<String>)>(
        "SELECT id, title, source, url, thumbnail_path FROM playlists ORDER BY title"
    ).fetch_all(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| Playlist { id: r.0, title: r.1, source: r.2, url: r.3, thumbnail_path: r.4 }).collect())
}

#[tauri::command]
async fn list_queue(state: tauri::State<'_, DbState>) -> Result<Vec<QueueItem>, String> {
    let rows = sqlx::query_as::<_, (String, Option<String>, String, f64, Option<String>, Option<String>, Option<String>, i64)>(
        "SELECT id, video_id, status, progress, speed, eta, error, created_at FROM queue_items ORDER BY created_at"
    ).fetch_all(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(rows.into_iter().map(|r| QueueItem { id: r.0, video_id: r.1, status: r.2, progress: r.3, speed: r.4, eta: r.5, error: r.6, created_at: r.7 }).collect())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
async fn fetch_metadata(url: String) -> Result<Metadata, String> {
    let ytdlp = find_ytdlp();
    let output = Command::new(&ytdlp).args(["--dump-json", "--no-playlist", &url]).output().await.map_err(|e| e.to_string())?;
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
async fn add_video(state: tauri::State<'_, DbState>, video: Video) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO videos (id, title, uploader, duration, thumbnail_path, source, url, file_path, file_size, downloaded_at, last_position, watched, playlist_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(&video.id).bind(&video.title).bind(&video.uploader).bind(&video.duration).bind(&video.thumbnail_path)
        .bind(&video.source).bind(&video.url).bind(&video.file_path).bind(&video.file_size).bind(&video.downloaded_at)
        .bind(&video.last_position).bind(if video.watched {1i64} else {0i64}).bind(&video.playlist_id)
        .execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Deserialize)]
struct ProgressPayload { percent: Option<f64>, speed: Option<String>, eta: Option<String> }

#[tauri::command]
async fn start_download(
    app: tauri::AppHandle,
    state: tauri::State<'_, DbState>,
    video_id: String,
    url: String,
    format_pref: String,
    download_dir: String,
) -> Result<String, String> {
    let queue_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    sqlx::query("INSERT INTO queue_items (id, video_id, status, created_at) VALUES (?,?,?,?)")
        .bind(&queue_id).bind(&video_id).bind("downloading").bind(now)
        .execute(&state.pool).await.map_err(|e| e.to_string())?;

    let pool = state.pool.clone();
    let app2 = app.clone();
    let format_arg = match format_pref.as_str() {
        "audio" => "bestaudio[ext=m4a]/bestaudio".to_string(),
        "original" => "best".to_string(),
        _ => "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".to_string(),
    };
    let ext = if format_pref == "audio" { "m4a" } else { "mp4" };
    let template = format!("{}/%(playlist_title|channel|uploader)s/%(title)s [%(id)s].{}", download_dir, ext);

    let queue_id_ret = queue_id.clone();
    tokio::spawn(async move {
        let ytdlp = find_ytdlp();
        let mut cmd = Command::new(&ytdlp);
        cmd.args([
            "-f", &format_arg,
            "--newline",
            "--no-update",
            "--js-runtimes", "deno",
            "--progress-template", r#"{"percent":%(progress._percent)s,"speed":"%(progress.speed)s","eta":"%(progress.eta)s"}"#,
            "--write-thumbnail", "--convert-thumbnails", "jpg",
            "-o", &template,
            &url,
        ]);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = sqlx::query("UPDATE queue_items SET status='failed', error=? WHERE id=?")
                    .bind(e.to_string()).bind(&queue_id).execute(&pool).await;
                let _ = app2.emit("download-progress", serde_json::json!({"queue_id": queue_id, "status":"failed","error": e.to_string()}));
                return;
            }
        };

        let stderr = child.stderr.take().unwrap();
        let stderr_lines = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
        let stderr_lines2 = stderr_lines.clone();
        tokio::spawn(async move {
            let mut r = BufReader::new(stderr).lines();
            while let Ok(Some(l)) = r.next_line().await {
                let mut g = stderr_lines2.lock().await;
                g.push(l);
                if g.len() > 20 { g.remove(0); }
            }
        });

        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();
        let mut final_file: Option<String> = None;
        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(p) = serde_json::from_str::<ProgressPayload>(&line) {
                let percent = p.percent.unwrap_or(0.0);
                let _ = sqlx::query("UPDATE queue_items SET progress=?, speed=?, eta=? WHERE id=?")
                    .bind(percent).bind(&p.speed).bind(&p.eta).bind(&queue_id).execute(&pool).await;
                let _ = app2.emit("download-progress", serde_json::json!({
                    "queue_id": queue_id, "status":"downloading", "progress": percent, "speed": p.speed, "eta": p.eta
                }));
            }
            if line.contains("Merging formats into") {
                if let Some(path) = line.split("Merging formats into").nth(1) {
                    let p = path.trim().trim_matches('"').to_string();
                    if !p.is_empty() { final_file = Some(p); }
                }
            } else if line.contains("Destination:") {
                if let Some(path) = line.split("Destination:").nth(1) {
                    let p = path.trim().to_string();
                    if p.ends_with(".mp4") || p.ends_with(".m4a") || p.ends_with(".mp3") || p.ends_with(".webm") {
                        final_file = Some(p);
                    }
                }
            }
        }
        let status = child.wait().await;
        let success = status.map(|s| s.success()).unwrap_or(false);
        if success {
            let _ = sqlx::query("UPDATE queue_items SET status='done', progress=100 WHERE id=?")
                .bind(&queue_id).execute(&pool).await;
            if let Some(fp) = &final_file {
                let _ = sqlx::query("UPDATE videos SET file_path=?, downloaded_at=? WHERE id=?")
                    .bind(fp).bind(chrono::Utc::now().timestamp()).bind(&video_id).execute(&pool).await;
            }
            let _ = app2.emit("download-progress", serde_json::json!({"queue_id": queue_id, "status":"done","progress":100.0, "file_path": final_file}));
        } else {
            let tail = stderr_lines.lock().await.join("\n");
            let msg = if tail.is_empty() { "yt-dlp failed".to_string() } else { tail };
            let _ = sqlx::query("UPDATE queue_items SET status='failed', error=? WHERE id=?")
                .bind(&msg).bind(&queue_id).execute(&pool).await;
            let _ = app2.emit("download-progress", serde_json::json!({"queue_id": queue_id, "status":"failed","error": msg}));
        }
    });

    Ok(queue_id_ret)
}

#[tauri::command]
async fn fetch_playlist_entries(url: String) -> Result<Vec<Metadata>, String> {
    let ytdlp = find_ytdlp();
    let output = Command::new(&ytdlp).args(["--flat-playlist", "--dump-json", &url]).output().await.map_err(|e| e.to_string())?;
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
async fn add_playlist(state: tauri::State<'_, DbState>, playlist: Playlist) -> Result<(), String> {
    sqlx::query("INSERT OR IGNORE INTO playlists (id, title, source, url, thumbnail_path) VALUES (?,?,?,?,?)")
        .bind(&playlist.id).bind(&playlist.title).bind(&playlist.source).bind(&playlist.url).bind(&playlist.thumbnail_path)
        .execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn cancel_download(state: tauri::State<'_, DbState>, queue_id: String) -> Result<(), String> {
    sqlx::query("UPDATE queue_items SET status='cancelled' WHERE id=?")
        .bind(&queue_id).execute(&state.pool).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let pool = tauri::async_runtime::block_on(init_db(app.handle()));
            app.manage(DbState { pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_setting, set_setting, list_videos, list_playlists, list_queue, pick_folder,
            fetch_metadata, add_video, start_download, cancel_download,
            fetch_playlist_entries, add_playlist
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}