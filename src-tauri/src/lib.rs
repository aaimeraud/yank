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
            app.manage(DbState { pool });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_setting,
            commands::set_setting,
            commands::list_videos,
            commands::list_playlists,
            commands::list_queue,
            commands::pick_folder,
            commands::fetch_metadata,
            commands::fetch_playlist_entries,
            commands::add_video,
            commands::add_playlist,
            commands::start_download_cmd,
            commands::cancel_download_cmd,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}