//! Commands for Settings and the machine: preferences, file pickers, the
//! external programs, logs.

use crate::downloads::DownloadManager;
use crate::error::{AppError, AppResult};
use crate::models::ToolchainReport;
use crate::settings::{self, Settings};
use tauri::Manager as _;
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use super::Manager;

#[tauri::command]
pub async fn get_settings(manager: Manager<'_>) -> AppResult<Settings> {
    Ok(manager.settings().await)
}

/// Store one setting and apply it at once (concurrency changes the running
/// queue; the others are read at the start of each download).
#[tauri::command]
pub async fn set_setting(manager: Manager<'_>, key: String, value: String) -> AppResult<Settings> {
    settings::set(manager.pool(), &key, &value).await?;
    let current = manager.settings().await;
    if key == settings::KEY_CONCURRENCY {
        manager.set_concurrency(current.concurrency);
    }
    Ok(current)
}

#[tauri::command]
pub async fn pick_folder(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .blocking_pick_folder()
        .map(|path| path.to_string())
}

#[tauri::command]
pub async fn pick_cookies_file(app: tauri::AppHandle) -> Option<String> {
    app.dialog()
        .file()
        .add_filter("Cookies", &["txt"])
        .blocking_pick_file()
        .map(|path| path.to_string())
}

#[tauri::command]
pub async fn toolchain_info(manager: Manager<'_>) -> AppResult<ToolchainReport> {
    Ok(toolchain_report(&manager).await)
}

pub async fn toolchain_report(manager: &DownloadManager) -> ToolchainReport {
    let tools = manager.toolchain();
    let path = |p: &Option<std::path::PathBuf>| p.as_ref().map(|p| p.display().to_string());
    ToolchainReport {
        ytdlp_path: path(&tools.ytdlp),
        ytdlp_version: manager.ytdlp_version().await,
        ffmpeg_path: path(&tools.ffmpeg),
        deno_path: path(&tools.deno),
    }
}

/// Open the folder holding `yank.log` (`~/Library/Logs/com.yank.app`).
#[tauri::command]
pub async fn open_logs_folder(app: tauri::AppHandle) -> AppResult<()> {
    let dir = app
        .path()
        .app_log_dir()
        .map_err(|e| AppError::user(format!("No log folder: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    app.opener()
        .open_path(dir.display().to_string(), None::<&str>)
        .map_err(|e| AppError::user(format!("Could not open {}: {e}", dir.display())))
}
