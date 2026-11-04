//! The download queue at runtime.
//!
//! [`DownloadManager`] is the one object commands talk to. It owns the
//! concurrency [`gate::Gate`], knows which queue rows have a live worker task
//! ("claims") and which yt-dlp process belongs to which row, and forwards
//! progress to the UI through an emit callback (a Tauri event in the app, a
//! recorder in tests).
//!
//! - [`enqueue`]: URL -> library rows + queue rows.
//! - [`worker`]: one row from queued to done/failed, with retries.
//! - [`process`]: one yt-dlp run.
//! - [`diagnostics`]: the "Copy diagnostics" text.

pub mod diagnostics;
pub mod enqueue;
mod gate;
mod process;
pub mod worker;

use crate::db::{queue, queue::Job};
use crate::error::AppResult;
use crate::models::{EnqueueSummary, Format, ProgressEvent, QueueStatus};
use crate::settings::Settings;
use crate::ytdlp::{info, Toolchain};
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

pub type Emit = Arc<dyn Fn(ProgressEvent) + Send + Sync>;

/// Cheap to clone: every clone shares the same state.
#[derive(Clone)]
pub struct DownloadManager {
    inner: Arc<Inner>,
}

struct Inner {
    pool: SqlitePool,
    toolchain: Toolchain,
    /// Download folder used until the user picks one.
    fallback_dir: PathBuf,
    gate: gate::Gate,
    /// Queue ids with a worker task alive. Prevents two workers per row.
    claims: Mutex<HashSet<String>>,
    /// yt-dlp process id per running queue id, for pause and cancel.
    pids: Mutex<HashMap<String, u32>>,
    /// Held while a URL is turned into rows, so two overlapping playlists
    /// pasted back to back cannot both queue the same video.
    enqueue_lock: tokio::sync::Mutex<()>,
    emit: Emit,
}

impl DownloadManager {
    pub fn new(
        pool: SqlitePool,
        toolchain: Toolchain,
        fallback_dir: PathBuf,
        concurrency: usize,
        emit: Emit,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                pool,
                toolchain,
                fallback_dir,
                gate: gate::Gate::new(concurrency),
                claims: Mutex::default(),
                pids: Mutex::default(),
                enqueue_lock: tokio::sync::Mutex::new(()),
                emit,
            }),
        }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.inner.pool
    }

    pub fn toolchain(&self) -> &Toolchain {
        &self.inner.toolchain
    }

    pub async fn settings(&self) -> Settings {
        Settings::load(self.pool(), &self.inner.fallback_dir).await
    }

    /// Download what a pasted URL points to. `format` overrides the default.
    pub async fn enqueue_url(&self, url: &str, format: Option<Format>) -> AppResult<EnqueueSummary> {
        let settings = self.settings().await;
        let url = url.trim();
        let info = info::fetch(self.toolchain(), url, settings.cookies_path.as_deref()).await?;
        let _serialized = self.inner.enqueue_lock.lock().await;
        let plan = enqueue::plan(self.pool(), &info, url, format.unwrap_or(settings.default_format)).await?;
        let summary = EnqueueSummary {
            title: info.title.clone(),
            is_playlist: info.is_playlist,
            queued: plan.jobs.len(),
            skipped: plan.skipped,
        };
        for job in plan.jobs {
            self.spawn(job);
        }
        Ok(summary)
    }

    /// Download a library video again, e.g. after its file went missing.
    pub async fn download_video(&self, video_id: &str, format: Option<Format>) -> AppResult<()> {
        let _serialized = self.inner.enqueue_lock.lock().await;
        if queue::has_active(self.pool(), video_id).await? {
            return Ok(());
        }
        let video = crate::db::videos::get(self.pool(), video_id).await?;
        let format = match format {
            Some(format) => format,
            None => self.settings().await.default_format,
        };
        let job = queue::insert(self.pool(), video_id, &video.url, format).await?;
        self.spawn(job);
        Ok(())
    }

    pub async fn pause(&self, queue_id: &str) -> AppResult<()> {
        use QueueStatus::*;
        queue::transition(self.pool(), queue_id, &[Queued, Downloading], Paused).await?;
        self.kill(queue_id);
        Ok(())
    }

    pub async fn cancel(&self, queue_id: &str) -> AppResult<()> {
        use QueueStatus::*;
        queue::transition(self.pool(), queue_id, &[Queued, Downloading, Paused], Cancelled).await?;
        self.kill(queue_id);
        Ok(())
    }

    /// Resume a paused row or retry a failed one, with its original format.
    pub async fn resume(&self, queue_id: &str) -> AppResult<()> {
        let fallback = self.settings().await.default_format;
        let _serialized = self.inner.enqueue_lock.lock().await;
        let job = queue::requeue(self.pool(), queue_id, fallback).await?;
        // A row whose worker is still alive (waiting for a slot, or about to
        // exit after a kill) is picked up by that worker; see worker::run.
        if self.claim(queue_id) {
            tokio::spawn(worker::run(self.clone(), job));
        }
        Ok(())
    }

    pub async fn remove(&self, queue_id: &str) -> AppResult<()> {
        self.cancel(queue_id).await?;
        queue::remove(self.pool(), queue_id).await
    }

    /// Resume every row in `status` (Paused for "Resume all", Failed for
    /// "Retry failed"). Returns how many rows.
    ///
    /// A row that cannot resume (it changed since it was listed, or its video
    /// is downloading from another row) is skipped, not fatal.
    pub async fn resume_all(&self, status: QueueStatus) -> AppResult<usize> {
        let ids = queue::ids_with_status(self.pool(), status).await?;
        let mut resumed = 0;
        for id in &ids {
            match self.resume(id).await {
                Ok(()) => resumed += 1,
                Err(e) => log::info!("resume {id} skipped: {e}"),
            }
        }
        Ok(resumed)
    }

    pub async fn pause_all(&self) -> AppResult<usize> {
        let mut ids = queue::ids_with_status(self.pool(), QueueStatus::Downloading).await?;
        ids.extend(queue::ids_with_status(self.pool(), QueueStatus::Queued).await?);
        for id in &ids {
            self.pause(id).await?;
        }
        Ok(ids.len())
    }

    pub fn set_concurrency(&self, limit: usize) {
        self.inner.gate.set_limit(limit);
    }

    /// Start a worker for a freshly inserted row.
    fn spawn(&self, job: Job) {
        if self.claim(&job.queue_id) {
            tokio::spawn(worker::run(self.clone(), job));
        }
    }

    pub(crate) fn emit(&self, event: ProgressEvent) {
        (self.inner.emit)(event);
    }

    fn gate(&self) -> &gate::Gate {
        &self.inner.gate
    }

    /// True when the caller now owns the row's worker.
    fn claim(&self, queue_id: &str) -> bool {
        self.inner.claims.lock().unwrap().insert(queue_id.to_string())
    }

    fn release(&self, queue_id: &str) {
        self.inner.claims.lock().unwrap().remove(queue_id);
    }

    fn register_pid(&self, queue_id: &str, pid: u32) {
        self.inner.pids.lock().unwrap().insert(queue_id.to_string(), pid);
    }

    fn forget_pid(&self, queue_id: &str) {
        self.inner.pids.lock().unwrap().remove(queue_id);
    }

    /// Stop the yt-dlp process group of a row (yt-dlp and any ffmpeg it
    /// started), if one is running. yt-dlp keeps the `.part` file, so a
    /// resumed download continues where it stopped.
    fn kill(&self, queue_id: &str) {
        let pid = self.inner.pids.lock().unwrap().get(queue_id).copied();
        if let Some(pid) = pid {
            terminate_group(pid);
        }
    }

    /// Stop every running download. Called when the app quits, so no yt-dlp
    /// keeps writing a file that the next launch will resume. The rows stay
    /// `downloading` and are parked as paused at the next start.
    pub fn kill_all(&self) {
        let pids: Vec<u32> = self.inner.pids.lock().unwrap().values().copied().collect();
        for pid in pids {
            terminate_group(pid);
        }
    }
}

/// SIGTERM to a whole process group (the negative pid).
fn terminate_group(pid: u32) {
    let _ = std::process::Command::new("kill")
        .args(["-TERM", "--", &format!("-{pid}")])
        .status();
}

#[cfg(test)]
mod tests;
