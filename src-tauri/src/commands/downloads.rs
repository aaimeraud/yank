//! Commands for adding downloads and controlling the queue.

use crate::db::queue;
use crate::downloads::{diagnostics, DownloadManager};
use crate::error::AppResult;
use crate::models::{EnqueueSummary, Format, QueueEntry, QueueStatus};
use tauri::State;

type Manager<'a> = State<'a, DownloadManager>;

/// Download whatever the URL points to: one video, or every entry of a
/// playlist/channel. `format` overrides the default from Settings.
#[tauri::command]
pub async fn enqueue_url(
    manager: Manager<'_>,
    url: String,
    format: Option<Format>,
) -> AppResult<EnqueueSummary> {
    manager.enqueue_url(&url, format).await
}

/// Download a library video again (its file is missing or was never fetched).
#[tauri::command]
pub async fn download_video(
    manager: Manager<'_>,
    video_id: String,
    format: Option<Format>,
) -> AppResult<()> {
    manager.download_video(&video_id, format).await
}

#[tauri::command]
pub async fn list_queue(manager: Manager<'_>) -> AppResult<Vec<QueueEntry>> {
    queue::list(manager.pool()).await
}

#[tauri::command]
pub async fn pause_download(manager: Manager<'_>, queue_id: String) -> AppResult<()> {
    manager.pause(&queue_id).await
}

/// Resume a paused row or retry a failed one.
#[tauri::command]
pub async fn resume_download(manager: Manager<'_>, queue_id: String) -> AppResult<()> {
    manager.resume(&queue_id).await
}

#[tauri::command]
pub async fn cancel_download(manager: Manager<'_>, queue_id: String) -> AppResult<()> {
    manager.cancel(&queue_id).await
}

#[tauri::command]
pub async fn remove_download(manager: Manager<'_>, queue_id: String) -> AppResult<()> {
    manager.remove(&queue_id).await
}

#[tauri::command]
pub async fn clear_finished_downloads(manager: Manager<'_>) -> AppResult<()> {
    queue::clear_finished(manager.pool()).await
}

#[tauri::command]
pub async fn pause_all_downloads(manager: Manager<'_>) -> AppResult<usize> {
    manager.pause_all().await
}

#[tauri::command]
pub async fn resume_all_downloads(manager: Manager<'_>) -> AppResult<usize> {
    manager.resume_all(QueueStatus::Paused).await
}

#[tauri::command]
pub async fn retry_failed_downloads(manager: Manager<'_>) -> AppResult<usize> {
    manager.resume_all(QueueStatus::Failed).await
}

/// Plain text describing a download and the machine, for bug reports.
#[tauri::command]
pub async fn download_diagnostics(
    app: tauri::AppHandle,
    manager: Manager<'_>,
    queue_id: String,
) -> AppResult<String> {
    let entry = queue::get(manager.pool(), &queue_id).await?;
    let tools = super::system::toolchain_report(manager.toolchain()).await;
    Ok(diagnostics::report(&entry, &tools, &app.package_info().version.to_string()))
}
