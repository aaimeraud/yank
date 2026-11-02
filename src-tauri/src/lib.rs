mod commands;
mod db;
mod download;
mod models;
mod util;

use db::DbState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let pool = tauri::async_runtime::block_on(db::init_db(app.handle()));
            tauri::async_runtime::block_on(download::recover_interrupted(&pool)).ok();
            tauri::async_runtime::block_on(db::reconcile_missing_files(&pool)).ok();
            let concurrency =
                db::concurrency(tauri::async_runtime::block_on(db::setting(&pool, "concurrency")));
            app.manage(DbState { pool });
            app.manage(download::DownloadState::new(concurrency));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_setting,
            commands::set_setting,
            commands::list_videos,
            commands::list_folders,
            commands::ensure_playlist_folder,
            commands::prune_missing_videos,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::move_video,
            commands::remove_video,
            commands::list_playlists,
            commands::list_queue,
            commands::pick_folder,
            commands::pick_file,
            commands::ytdlp_version,
            commands::fetch_metadata,
            commands::fetch_playlist_info,
            commands::add_video,
            commands::add_playlist,
            commands::start_download,
            commands::cancel_download,
            commands::pause_download,
            commands::resume_download,
            commands::remove_download,
            commands::clear_finished_downloads,
            commands::update_playback,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}