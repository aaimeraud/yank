//! Commands for the Library view: videos, folders, playback state.

use crate::db::{folders, playlists, videos};
use crate::downloads::DownloadManager;
use crate::error::{AppError, AppResult};
use crate::models::{Folder, Playlist, Video};
use tauri::State;

type Manager<'a> = State<'a, DownloadManager>;

#[tauri::command]
pub async fn list_videos(manager: Manager<'_>) -> AppResult<Vec<Video>> {
    videos::list(manager.pool()).await
}

#[tauri::command]
pub async fn list_folders(manager: Manager<'_>) -> AppResult<Vec<Folder>> {
    folders::list(manager.pool()).await
}

#[tauri::command]
pub async fn list_playlists(manager: Manager<'_>) -> AppResult<Vec<Playlist>> {
    playlists::list(manager.pool()).await
}

#[tauri::command]
pub async fn create_folder(manager: Manager<'_>, name: String) -> AppResult<Folder> {
    folders::create(manager.pool(), &name).await
}

#[tauri::command]
pub async fn rename_folder(manager: Manager<'_>, id: String, name: String) -> AppResult<()> {
    folders::rename(manager.pool(), &id, &name).await
}

#[tauri::command]
pub async fn delete_folder(manager: Manager<'_>, id: String) -> AppResult<()> {
    folders::delete(manager.pool(), &id).await
}

/// Move a selection into a folder (`None` to unfile). Stops at the first
/// failure; the UI refreshes afterwards and shows exactly what moved.
#[tauri::command]
pub async fn move_videos(
    manager: Manager<'_>,
    video_ids: Vec<String>,
    folder_id: Option<String>,
) -> AppResult<()> {
    for id in &video_ids {
        videos::move_to_folder(manager.pool(), id, folder_id.as_deref()).await?;
    }
    Ok(())
}

/// Remove a selection from the library, deleting the files when asked.
#[tauri::command]
pub async fn remove_videos(
    manager: Manager<'_>,
    video_ids: Vec<String>,
    delete_file: bool,
) -> AppResult<()> {
    videos::remove_many(manager.pool(), &video_ids, delete_file).await
}

#[tauri::command]
pub async fn update_playback(
    manager: Manager<'_>,
    video_id: String,
    position: i64,
    watched: bool,
) -> AppResult<()> {
    videos::update_playback(manager.pool(), &video_id, position, watched).await
}

/// Check these rows against the disk and forget files that are gone.
/// Returns the ids that lost their file.
#[tauri::command]
pub async fn prune_missing_videos(manager: Manager<'_>, ids: Vec<String>) -> AppResult<Vec<String>> {
    videos::clear_missing_files(manager.pool(), &ids).await
}

/// Show the video's file in Finder. The path comes from the database, never
/// from the UI, so this cannot be used to open arbitrary paths.
#[tauri::command]
pub async fn reveal_video(manager: Manager<'_>, video_id: String) -> AppResult<()> {
    let video = videos::get(manager.pool(), &video_id).await?;
    let path = video
        .file_path
        .ok_or_else(|| AppError::user("This video has not been downloaded yet."))?;
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|e| AppError::user(format!("Could not show {path} in Finder: {e}")))
}
