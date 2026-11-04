//! Running one yt-dlp download process and collecting what it reports.

use super::DownloadManager;
use crate::db::queue;
use crate::models::{ProgressEvent, QueueStatus};
use crate::ytdlp::args::{download_args, DownloadRequest};
use crate::ytdlp::output::{parse_line, Line, Progress, STDERR_TAIL_LINES};
use std::collections::VecDeque;
use std::process::Stdio;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex;

/// Progress lines arrive many times a second; the database only needs to
/// know roughly where a download is if the app quits.
const DB_WRITE_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Debug, Default)]
pub struct Outcome {
    pub success: bool,
    /// Path printed on the `YANK_FILE:` line.
    pub file: Option<String>,
    /// Last lines of stderr, newest last.
    pub stderr_tail: String,
}

pub async fn run(manager: &DownloadManager, queue_id: &str, request: &DownloadRequest) -> Outcome {
    let toolchain = manager.toolchain();
    let mut command = tokio::process::Command::new(toolchain.ytdlp_program());
    command
        .args(toolchain.common_args())
        .args(download_args(request))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // Its own process group, so pause/cancel/quit can stop the ffmpeg
        // that yt-dlp starts for merging, not just yt-dlp itself.
        .process_group(0)
        .kill_on_drop(true);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => {
            return Outcome {
                stderr_tail: format!("Could not start yt-dlp ({}): {e}", toolchain.ytdlp_program().display()),
                ..Outcome::default()
            }
        }
    };
    if let Some(pid) = child.id() {
        manager.register_pid(queue_id, pid);
        // A pause or cancel that landed between "downloading" and this point
        // found no process to stop. Honour it now.
        if queue::status(manager.pool(), queue_id).await != Some(QueueStatus::Downloading) {
            manager.kill(queue_id);
        }
    }

    let stderr = child.stderr.take().expect("stderr is piped");
    let tail = Arc::new(Mutex::new(VecDeque::with_capacity(STDERR_TAIL_LINES)));
    let stderr_task = tokio::spawn(collect_tail(stderr, tail.clone()));

    let stdout = child.stdout.take().expect("stdout is piped");
    let file = follow_stdout(manager, queue_id, stdout).await;

    let status = child.wait().await;
    // The pipe closes when the child exits, but the reader may not have run
    // yet. Without this await a real 403 looks like an empty error and the
    // retry never fires.
    let _ = stderr_task.await;
    manager.forget_pid(queue_id);

    let stderr_tail = tail.lock().await.iter().cloned().collect::<Vec<_>>().join("\n");
    Outcome {
        success: status.map(|s| s.success()).unwrap_or(false),
        file,
        stderr_tail,
    }
}

/// Forward progress to the database and the UI; return the final file path.
async fn follow_stdout(
    manager: &DownloadManager,
    queue_id: &str,
    stdout: tokio::process::ChildStdout,
) -> Option<String> {
    let mut lines = BufReader::new(stdout).lines();
    let mut file = None;
    let mut last_write: Option<Instant> = None;
    while let Ok(Some(line)) = lines.next_line().await {
        match parse_line(&line) {
            Line::Progress(progress) => {
                if last_write.is_none_or(|at| at.elapsed() >= DB_WRITE_INTERVAL) {
                    last_write = Some(Instant::now());
                    let _ = queue::set_progress(
                        manager.pool(),
                        queue_id,
                        progress.percent,
                        progress.speed.as_deref(),
                        progress.eta.as_deref(),
                    )
                    .await;
                }
                manager.emit(progress_event(queue_id, progress));
            }
            Line::File(path) => file = Some(path),
            Line::Other => {}
        }
    }
    file
}

fn progress_event(queue_id: &str, progress: Progress) -> ProgressEvent {
    ProgressEvent {
        progress: Some(progress.percent),
        speed: progress.speed,
        eta: progress.eta,
        ..ProgressEvent::status(queue_id, QueueStatus::Downloading)
    }
}

async fn collect_tail(
    stderr: tokio::process::ChildStderr,
    tail: Arc<Mutex<VecDeque<String>>>,
) {
    let mut lines = BufReader::new(stderr).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        let mut tail = tail.lock().await;
        if tail.len() == STDERR_TAIL_LINES {
            tail.pop_front();
        }
        tail.push_back(line);
    }
}
