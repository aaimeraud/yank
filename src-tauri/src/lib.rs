//! Yank's backend. Start reading at `run()` below, then:
//!
//! - `commands/`  the IPC surface the UI calls.
//! - `downloads/` the queue at runtime: enqueue, workers, retries.
//! - `ytdlp/`     how yt-dlp is found, invoked and parsed.
//! - `db/`        SQLite access, one file per table.
//! - `disk`       moving deleted files to the Trash.
//! - `settings`   user preferences with defaults.
//! - `models`     types shared with the UI (`src/types.ts`).
//!
//! `docs/architecture.md` walks through a download end to end.

mod commands;
mod db;
mod disk;
mod downloads;
mod error;
mod models;
mod settings;
mod ytdlp;

use downloads::DownloadManager;
use std::sync::Arc;
use tauri::{Emitter, Manager};

/// Name of the event that carries [`models::ProgressEvent`] to the UI.
pub const PROGRESS_EVENT: &str = "download-progress";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            // Builder::new() comes with its own targets; clear them so each
            // line is written once to ~/Library/Logs/com.yank.app/yank.log.
            tauri_plugin_log::Builder::new()
                .clear_targets()
                .level(log::LevelFilter::Info)
                .target(tauri_plugin_log::Target::new(
                    tauri_plugin_log::TargetKind::LogDir { file_name: Some("yank".into()) },
                ))
                .target(tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout))
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let manager = tauri::async_runtime::block_on(start_backend(app.handle()))?;
            app.manage(manager);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::library::list_videos,
            commands::library::list_folders,
            commands::library::create_folder,
            commands::library::rename_folder,
            commands::library::delete_folder,
            commands::library::move_videos,
            commands::library::remove_videos,
            commands::library::update_playback,
            commands::library::prune_missing_videos,
            commands::library::reveal_video,
            commands::downloads::enqueue_url,
            commands::downloads::download_video,
            commands::downloads::list_queue,
            commands::downloads::pause_download,
            commands::downloads::resume_download,
            commands::downloads::cancel_download,
            commands::downloads::remove_download,
            commands::downloads::clear_finished_downloads,
            commands::downloads::pause_all_downloads,
            commands::downloads::resume_all_downloads,
            commands::downloads::retry_failed_downloads,
            commands::downloads::download_diagnostics,
            commands::system::get_settings,
            commands::system::set_setting,
            commands::system::pick_folder,
            commands::system::pick_cookies_file,
            commands::system::toolchain_info,
            commands::system::open_logs_folder,
            commands::youtube::search_youtube,
            commands::youtube::inspect_url,
            commands::youtube::stream_video,
        ])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| {
            // Stop running yt-dlp processes so none outlives the app.
            if let tauri::RunEvent::Exit = event
                && let Some(manager) = app.try_state::<DownloadManager>()
            {
                manager.kill_all();
            }
        });
}

/// Open the database, repair state left by the last session, find yt-dlp,
/// and build the download manager.
async fn start_backend(app: &tauri::AppHandle) -> Result<DownloadManager, Box<dyn std::error::Error>> {
    let data_dir = app.path().app_data_dir()?;
    std::fs::create_dir_all(&data_dir)?;
    let pool = db::open(&data_dir.join("yank.db")).await?;

    db::queue::recover_interrupted(&pool).await?;
    let cleared = db::videos::reconcile_missing_files(&pool).await?;
    if cleared > 0 {
        log::info!("{cleared} library files were missing and have been cleared");
    }

    let fallback_dir = settings::default_download_dir(app.path().video_dir().ok());
    std::fs::create_dir_all(&fallback_dir)?;
    let concurrency = settings::Settings::load(&pool, &fallback_dir).await.concurrency;
    let toolchain = ytdlp::Toolchain::detect();
    log::info!("toolchain: {toolchain:?}");

    let handle = app.clone();
    let emit: downloads::Emit = Arc::new(move |event| {
        let _ = handle.emit(PROGRESS_EVENT, event);
    });
    Ok(DownloadManager::new(pool, toolchain, fallback_dir, concurrency, emit))
}
