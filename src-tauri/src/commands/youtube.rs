//! Commands for the YouTube screen: search, look inside a playlist, and
//! stream a video before (or instead of) downloading it. Downloads go
//! through `enqueue_url` like a pasted link.

use super::Manager;
use crate::error::AppResult;
use crate::models::{SearchKind, SearchPage, Stream, UrlInfo};
use crate::ytdlp::{info, search, stream};
use std::time::Duration;

/// Listing a long playlist takes a few seconds; two minutes means it hung.
const INSPECT_LIMIT: Duration = Duration::from_secs(120);

/// One page (0-based) of YouTube results of one kind.
#[tauri::command]
pub async fn search_youtube(
    manager: Manager<'_>,
    query: String,
    kind: SearchKind,
    page: usize,
) -> AppResult<SearchPage> {
    let cookies = manager.settings().await.cookies_path;
    search::search(manager.toolchain(), &query, kind, page, cookies.as_deref()).await
}

/// What a URL holds, without queueing anything: a playlist's videos, for
/// the playlist view of the YouTube screen.
#[tauri::command]
pub async fn inspect_url(manager: Manager<'_>, url: String) -> AppResult<UrlInfo> {
    let cookies = manager.settings().await.cookies_path;
    info::inspect(manager.toolchain(), url.trim(), cookies.as_deref(), INSPECT_LIMIT).await
}

/// Where the player can stream `url` from. The answer expires after a few
/// hours and only works from this machine's IP, so it is asked right before
/// playing and never stored.
#[tauri::command]
pub async fn stream_video(manager: Manager<'_>, url: String) -> AppResult<Stream> {
    let cookies = manager.settings().await.cookies_path;
    let resolved = stream::resolve(manager.toolchain(), url.trim(), cookies.as_deref()).await;
    if let Err(error) = &resolved {
        log::warn!("stream {url}: {error}");
    }
    resolved
}
