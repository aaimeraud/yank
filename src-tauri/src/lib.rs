use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use sqlx::migrate::MigrateDatabase;
use sqlx::Sqlite;
use std::path::PathBuf;
use tauri::Manager;

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

#[tauri::command]
async fn get_setting(state: tauri::State<'_, DbState>, key: String) -> Result<Option<String>, String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT value FROM settings WHERE key = ?")
        .bind(&key)
        .fetch_optional(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(row.map(|r| r.0))
}

#[tauri::command]
async fn set_setting(state: tauri::State<'_, DbState>, key: String, value: String) -> Result<(), String> {
    sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .bind(&key)
        .bind(&value)
        .execute(&state.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn list_videos(state: tauri::State<'_, DbState>) -> Result<Vec<Video>, String> {
    let rows = sqlx::query_as::<_, (String, String, Option<String>, Option<i64>, Option<String>, String, String, Option<String>, Option<i64>, Option<i64>, i64, i64, Option<String>)>(
        "SELECT id, title, uploader, duration, thumbnail_path, source, url, file_path, file_size, downloaded_at, last_position, watched, playlist_id FROM videos ORDER BY downloaded_at DESC"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| Video {
            id: r.0,
            title: r.1,
            uploader: r.2,
            duration: r.3,
            thumbnail_path: r.4,
            source: r.5,
            url: r.6,
            file_path: r.7,
            file_size: r.8,
            downloaded_at: r.9,
            last_position: r.10,
            watched: r.11 != 0,
            playlist_id: r.12,
        })
        .collect())
}

#[tauri::command]
async fn list_playlists(state: tauri::State<'_, DbState>) -> Result<Vec<Playlist>, String> {
    let rows = sqlx::query_as::<_, (String, String, String, String, Option<String>)>(
        "SELECT id, title, source, url, thumbnail_path FROM playlists ORDER BY title"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| Playlist {
            id: r.0,
            title: r.1,
            source: r.2,
            url: r.3,
            thumbnail_path: r.4,
        })
        .collect())
}

#[tauri::command]
async fn list_queue(state: tauri::State<'_, DbState>) -> Result<Vec<QueueItem>, String> {
    let rows = sqlx::query_as::<_, (String, Option<String>, String, f64, Option<String>, Option<String>, Option<String>, i64)>(
        "SELECT id, video_id, status, progress, speed, eta, error, created_at FROM queue_items ORDER BY created_at"
    )
    .fetch_all(&state.pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(|r| QueueItem {
            id: r.0,
            video_id: r.1,
            status: r.2,
            progress: r.3,
            speed: r.4,
            eta: r.5,
            error: r.6,
            created_at: r.7,
        })
        .collect())
}

#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
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
            get_setting,
            set_setting,
            list_videos,
            list_playlists,
            list_queue,
            pick_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}