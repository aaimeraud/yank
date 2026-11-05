//! The life of one queued download, from waiting for a slot to done/failed.
//!
//! The worker never trusts its own idea of the state. Pause, cancel, resume
//! and remove are written to the queue row by `DownloadManager` (and pause and
//! cancel kill the process); after every yt-dlp run and every retry backoff
//! the worker reads the row back and [`decide`]s what happens next.

use super::process::{self, Outcome};
use super::DownloadManager;
use crate::db::{folders, queue, queue::Job, videos};
use crate::models::{ProgressEvent, QueueStatus};
use crate::settings::Settings;
use crate::ytdlp::output::NO_REASON;
use crate::ytdlp::args::DownloadRequest;
use crate::ytdlp::output::is_transient_failure;
use std::time::Duration;

/// Three attempts in total: YouTube rejects a valid signed URL often enough
/// that a fresh extraction a moment later succeeds. See ADR 0004.
pub const MAX_ATTEMPTS: u32 = 3;

/// What to do after a yt-dlp run.
#[derive(Debug, PartialEq)]
pub enum Decision {
    /// The file is on disk.
    Finished(String),
    /// Transient error: wait, then extract again.
    Retry(Duration),
    /// Give up and show this message.
    Failed(String),
    /// The user paused, cancelled, removed or resumed the row meanwhile.
    Interrupted,
}

pub fn decide(status: Option<QueueStatus>, outcome: &Outcome, attempt: u32) -> Decision {
    if status != Some(QueueStatus::Downloading) {
        return Decision::Interrupted;
    }
    if outcome.success {
        return match &outcome.file {
            Some(path) => Decision::Finished(path.clone()),
            None => Decision::Failed("yt-dlp finished but did not report a file.".into()),
        };
    }
    if attempt < MAX_ATTEMPTS && is_transient_failure(&outcome.stderr_tail) {
        return Decision::Retry(retry_delay(attempt));
    }
    if outcome.stderr_tail.trim().is_empty() {
        Decision::Failed(NO_REASON.into())
    } else {
        Decision::Failed(outcome.stderr_tail.clone())
    }
}

/// 2s, then 4s: long enough for a rate limit to relax, short enough that the
/// queue still feels alive.
pub fn retry_delay(attempt: u32) -> Duration {
    Duration::from_secs(2 * u64::from(attempt.clamp(1, MAX_ATTEMPTS)))
}

/// Entry point of the task spawned by `DownloadManager::spawn`. The caller
/// already holds the claim on `job.queue_id`.
pub async fn run(manager: DownloadManager, job: Job) {
    let _slot = manager.gate().acquire().await;
    loop {
        if queue::status(manager.pool(), &job.queue_id).await == Some(QueueStatus::Queued)
            && !run_attempts(&manager, &job).await
        {
            // The database refused a write (disk full, read-only). Looping
            // would spin; the row stays queued and is parked as paused at the
            // next launch.
            manager.release(&job.queue_id);
            return;
        }
        // Give the claim back, then look once more: a resume that landed while
        // this task held the claim could not start a worker of its own.
        manager.release(&job.queue_id);
        let requeued =
            queue::status(manager.pool(), &job.queue_id).await == Some(QueueStatus::Queued);
        if !requeued || !manager.claim(&job.queue_id) {
            return;
        }
    }
}

/// Run the download until it settles. Returns false only when the database
/// failed, so `run` knows not to try again.
async fn run_attempts(manager: &DownloadManager, job: &Job) -> bool {
    let pool = manager.pool();
    let started = queue::transition(pool, &job.queue_id, &[QueueStatus::Queued], QueueStatus::Downloading).await;
    match started {
        Ok(true) => {}
        Ok(false) => return true,
        Err(e) => {
            log::error!("download {} could not start: {e}", job.queue_id);
            return false;
        }
    }
    manager.emit(ProgressEvent::status(&job.queue_id, QueueStatus::Downloading));
    let request = request_for(manager, job).await;
    log::info!("download {} started: {}", job.queue_id, job.url);

    for attempt in 1..=MAX_ATTEMPTS {
        let outcome = process::run(manager, &job.queue_id, &request).await;
        let status = queue::status(pool, &job.queue_id).await;
        match decide(status, &outcome, attempt) {
            Decision::Finished(path) => finish(manager, job, &path).await,
            Decision::Failed(message) => fail(manager, job, &message).await,
            Decision::Interrupted => report_status(manager, &job.queue_id).await,
            Decision::Retry(delay) => {
                log::warn!("download {} attempt {attempt} failed, retrying: {}", job.queue_id, outcome.stderr_tail);
                let _ = queue::reset_for_retry(pool, &job.queue_id).await;
                manager.emit(ProgressEvent {
                    progress: Some(0.0),
                    error: Some(String::new()),
                    ..ProgressEvent::status(&job.queue_id, QueueStatus::Downloading)
                });
                tokio::time::sleep(delay).await;
                if queue::status(pool, &job.queue_id).await == Some(QueueStatus::Downloading) {
                    continue;
                }
                report_status(manager, &job.queue_id).await;
            }
        }
        return true;
    }
    true
}

/// Settings are read per download, so a folder or cookies change applies to
/// the next download without a restart.
async fn request_for(manager: &DownloadManager, job: &Job) -> DownloadRequest {
    let settings: Settings = manager.settings().await;
    DownloadRequest {
        url: job.url.clone(),
        format: job.format,
        download_dir: settings.download_dir.into(),
        folder: folders::disk_name_for_video(manager.pool(), &job.video_id).await,
        cookies: settings.cookies_path,
    }
}

/// The file is complete on disk, so the library gets it whatever happens to
/// the queue row; the row only turns "done" if the user did not cancel or
/// pause it in the last moments.
async fn finish(manager: &DownloadManager, job: &Job, path: &str) {
    let pool = manager.pool();
    let _ = videos::set_downloaded(pool, &job.video_id, path).await;
    log::info!("download {} finished: {path}", job.queue_id);
    if matches!(queue::mark_done(pool, &job.queue_id).await, Ok(true)) {
        manager.emit(ProgressEvent {
            progress: Some(100.0),
            ..ProgressEvent::status(&job.queue_id, QueueStatus::Done)
        });
    } else {
        report_status(manager, &job.queue_id).await;
    }
}

/// When a Retry requeued the row meanwhile, the failure is not recorded and
/// `run` picks the row up again.
async fn fail(manager: &DownloadManager, job: &Job, message: &str) {
    log::error!("download {} failed ({}): {message}", job.queue_id, job.url);
    if matches!(queue::mark_failed(manager.pool(), &job.queue_id, message).await, Ok(true)) {
        manager.emit(ProgressEvent {
            error: Some(message.to_string()),
            ..ProgressEvent::status(&job.queue_id, QueueStatus::Failed)
        });
    } else {
        report_status(manager, &job.queue_id).await;
    }
}

/// Tell the UI where the row ended up after an interruption.
async fn report_status(manager: &DownloadManager, queue_id: &str) {
    if let Some(status) = queue::status(manager.pool(), queue_id).await {
        manager.emit(ProgressEvent::status(queue_id, status));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use QueueStatus::*;

    fn failed(stderr: &str) -> Outcome {
        Outcome { success: false, file: None, stderr_tail: stderr.into() }
    }

    const FORBIDDEN: &str = "ERROR: unable to download video data: HTTP Error 403: Forbidden";

    #[test]
    fn success_with_a_file_finishes() {
        let ok = Outcome { success: true, file: Some("/a.mp4".into()), stderr_tail: String::new() };
        assert_eq!(decide(Some(Downloading), &ok, 1), Decision::Finished("/a.mp4".into()));
    }

    #[test]
    fn success_without_a_file_is_a_failure() {
        let odd = Outcome { success: true, file: None, stderr_tail: String::new() };
        assert!(matches!(decide(Some(Downloading), &odd, 1), Decision::Failed(_)));
    }

    #[test]
    fn transient_errors_retry_until_the_last_attempt() {
        assert_eq!(decide(Some(Downloading), &failed(FORBIDDEN), 1), Decision::Retry(Duration::from_secs(2)));
        assert_eq!(decide(Some(Downloading), &failed(FORBIDDEN), 2), Decision::Retry(Duration::from_secs(4)));
        assert_eq!(decide(Some(Downloading), &failed(FORBIDDEN), 3), Decision::Failed(FORBIDDEN.into()));
    }

    #[test]
    fn permanent_errors_fail_at_once() {
        let bad = failed("ERROR: Unsupported URL: https://example.com");
        assert!(matches!(decide(Some(Downloading), &bad, 1), Decision::Failed(m) if m.contains("Unsupported")));
        assert_eq!(
            decide(Some(Downloading), &failed("  "), 1),
            Decision::Failed(NO_REASON.into())
        );
    }

    #[test]
    fn the_users_choice_beats_the_process_result() {
        let ok = Outcome { success: true, file: Some("/a.mp4".into()), stderr_tail: String::new() };
        for status in [Some(Paused), Some(Cancelled), Some(Queued), None] {
            assert_eq!(decide(status, &ok, 1), Decision::Interrupted, "{status:?}");
            assert_eq!(decide(status, &failed(FORBIDDEN), 1), Decision::Interrupted, "{status:?}");
        }
    }
}
