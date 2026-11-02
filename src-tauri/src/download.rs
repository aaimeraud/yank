use serde::Deserialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Semaphore;

#[derive(Deserialize)]
struct ProgressPayload {
    percent: Option<f64>,
    speed: Option<String>,
    eta: Option<String>,
}

#[derive(Clone)]
pub struct DownloadState {
    sem: Arc<Semaphore>,
    pids: Arc<Mutex<HashMap<String, u32>>>,
    active: Arc<Mutex<HashSet<String>>>,
}

impl DownloadState {
    pub fn new(concurrency: usize) -> Self {
        Self {
            sem: Arc::new(Semaphore::new(concurrency)),
            pids: Arc::new(Mutex::new(HashMap::new())),
            active: Arc::new(Mutex::new(HashSet::new())),
        }
    }
}

fn claim(state: &DownloadState, queue_id: &str) -> bool {
    state.active.lock().unwrap().insert(queue_id.to_string())
}

fn release(state: &DownloadState, queue_id: &str) {
    state.active.lock().unwrap().remove(queue_id);
}

fn kill_pid(state: &DownloadState, queue_id: &str) {
    if let Some(pid) = state.pids.lock().unwrap().get(queue_id).copied() {
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }
}

async fn queue_status(pool: &SqlitePool, queue_id: &str) -> Option<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT status FROM queue_items WHERE id=?")
        .bind(queue_id)
        .fetch_optional(pool)
        .await
        .ok()?;
    row.map(|r| r.0)
}

/// Downloads interrupted by an app quit cannot still be running. Put them back
/// in a resumable state instead of leaving rows stuck on "downloading" forever.
pub async fn recover_interrupted(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query("UPDATE queue_items SET status='paused', speed=NULL, eta=NULL WHERE status IN ('queued','downloading')")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn pause_download(
    pool: &SqlitePool,
    state: &DownloadState,
    queue_id: String,
) -> Result<(), String> {
    sqlx::query("UPDATE queue_items SET status='paused', speed=NULL, eta=NULL WHERE id=? AND status IN ('queued','downloading')")
        .bind(&queue_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    kill_pid(state, &queue_id);
    Ok(())
}

pub async fn cancel_download(
    pool: &SqlitePool,
    state: &DownloadState,
    queue_id: String,
) -> Result<(), String> {
    sqlx::query("UPDATE queue_items SET status='cancelled', speed=NULL, eta=NULL WHERE id=? AND status IN ('queued','downloading','paused')")
        .bind(&queue_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    kill_pid(state, &queue_id);
    Ok(())
}

pub async fn remove_download(
    pool: &SqlitePool,
    state: &DownloadState,
    queue_id: String,
) -> Result<(), String> {
    sqlx::query("UPDATE queue_items SET status='cancelled' WHERE id=? AND status IN ('queued','downloading','paused')")
        .bind(&queue_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    kill_pid(state, &queue_id);

    let row: Option<(Option<String>,)> = sqlx::query_as("SELECT video_id FROM queue_items WHERE id=?")
        .bind(&queue_id)
        .fetch_optional(pool)
        .await
        .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM queue_items WHERE id=?")
        .bind(&queue_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;

    if let Some((Some(video_id),)) = row {
        sqlx::query(
            "DELETE FROM videos WHERE id=? AND file_path IS NULL AND NOT EXISTS (
                SELECT 1 FROM queue_items WHERE video_id=? AND status IN ('queued','downloading','paused')
            )",
        )
        .bind(&video_id)
        .bind(&video_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Clear every finished row in one go, dropping videos that never produced a file.
pub async fn clear_finished_downloads(pool: &SqlitePool) -> Result<(), String> {
    sqlx::query(
        "DELETE FROM videos WHERE file_path IS NULL AND id IN (
            SELECT video_id FROM queue_items WHERE status IN ('done','failed','cancelled') AND video_id IS NOT NULL
        ) AND NOT EXISTS (
            SELECT 1 FROM queue_items q2 WHERE q2.video_id = videos.id AND q2.status IN ('queued','downloading','paused')
        )",
    )
    .execute(pool)
    .await
    .map_err(|e| e.to_string())?;
    sqlx::query("DELETE FROM queue_items WHERE status IN ('done','failed','cancelled')")
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn start_download<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    state: DownloadState,
    video_id: String,
    url: String,
    format_pref: String,
    download_dir: String,
) -> Result<String, String> {
    let queue_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp();
    sqlx::query("INSERT INTO queue_items (id, video_id, status, created_at) VALUES (?,?,?,?)")
        .bind(&queue_id)
        .bind(&video_id)
        .bind("queued")
        .bind(now)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    claim(&state, &queue_id);
    spawn_download(app, pool, state, queue_id.clone(), video_id, url, format_pref, download_dir);
    Ok(queue_id)
}

pub async fn resume_download<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    state: DownloadState,
    queue_id: String,
    format_pref: String,
    download_dir: String,
) -> Result<(), String> {
    let row: Option<(Option<String>,)> = sqlx::query_as("SELECT video_id FROM queue_items WHERE id=?")
        .bind(&queue_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let video_id = row
        .and_then(|r| r.0)
        .ok_or_else(|| "That download no longer exists.".to_string())?;

    let video: Option<(String,)> = sqlx::query_as("SELECT url FROM videos WHERE id=?")
        .bind(&video_id)
        .fetch_optional(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let url = video
        .map(|v| v.0)
        .ok_or_else(|| "That video no longer exists.".to_string())?;

    sqlx::query("UPDATE queue_items SET status='queued', error=NULL, speed=NULL, eta=NULL WHERE id=?")
        .bind(&queue_id)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;

    // A paused item that is still waiting for a concurrency slot already has a
    // task; flipping it back to queued is enough. A running item that was just
    // killed is requeued by its own task when the process exits.
    if !claim(&state, &queue_id) {
        return Ok(());
    }
    spawn_download(app, pool, state, queue_id, video_id, url, format_pref, download_dir);
    Ok(())
}

/// YouTube rejects a signed media URL often enough that the identical command
/// works a moment later (yt-dlp issue 17395). Each attempt re-runs extraction,
/// so the retry asks for a fresh signature instead of reusing the stale one.
const MAX_ATTEMPTS: u32 = 3;

fn spawn_download<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    state: DownloadState,
    queue_id: String,
    video_id: String,
    url: String,
    format_pref: String,
    download_dir: String,
) {
    spawn_download_with(
        app,
        pool,
        state,
        queue_id,
        video_id,
        url,
        format_pref,
        download_dir,
        crate::util::find_ytdlp(),
    );
}

#[allow(clippy::too_many_arguments)]
fn spawn_download_with<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    pool: SqlitePool,
    state: DownloadState,
    queue_id: String,
    video_id: String,
    url: String,
    format_pref: String,
    download_dir: String,
    ytdlp: String,
) {
    let format_arg = match format_pref.as_str() {
        "audio" => "bestaudio[ext=m4a]/bestaudio".to_string(),
        "original" => "best".to_string(),
        _ => "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".to_string(),
    };
    let ext = if format_pref == "audio" { "m4a" } else { "mp4" };

    tokio::spawn(async move {
        let _permit = match state.sem.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => {
                release(&state, &queue_id);
                return;
            }
        };

        // Cancelled, paused or removed while waiting in the queue.
        if queue_status(&pool, &queue_id).await.as_deref() != Some("queued") {
            release(&state, &queue_id);
            return;
        }
        let _ = sqlx::query("UPDATE queue_items SET status='downloading' WHERE id=?")
            .bind(&queue_id)
            .execute(&pool)
            .await;

        // The library folder becomes the directory on disk, so a playlist video
        // lands in a folder named after the playlist instead of a channel name.
        // An unfiled video still falls back to its uploader.
        let template = match output_folder(&pool, &video_id).await {
            Some(folder) => format!("{}/{}/%(title)s [%(id)s].{}", download_dir, folder, ext),
            None => format!("{}/%(channel,uploader)s/%(title)s [%(id)s].{}", download_dir, ext),
        };

        let mut attempt = 0;
        loop {
            attempt += 1;
            let outcome = run_ytdlp(
                &app, &pool, &state, &queue_id, &ytdlp, &format_arg, &template, &url,
            )
            .await;

            let Some(current) = queue_status(&pool, &queue_id).await else {
                release(&state, &queue_id);
                return;
            };

            if current == "cancelled" {
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({"queue_id": queue_id, "status":"cancelled"}),
                );
                break;
            }
            if current == "paused" {
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({"queue_id": queue_id, "status":"paused"}),
                );
                break;
            }
            if current == "queued" {
                // Resume arrived while the old process was still exiting. Requeue it.
                release(&state, &queue_id);
                if claim(&state, &queue_id) {
                    spawn_download_with(
                        app, pool, state, queue_id, video_id, url, format_pref, download_dir,
                        ytdlp,
                    );
                }
                return;
            }
            if outcome.success {
                let _ = sqlx::query("UPDATE queue_items SET status='done', progress=100, speed=NULL, eta=NULL, error=NULL WHERE id=?")
                    .bind(&queue_id)
                    .execute(&pool)
                    .await;
                if let Some(fp) = &outcome.final_file {
                    let thumb = crate::util::find_thumbnail(fp);
                    let _ = sqlx::query("UPDATE videos SET file_path=?, downloaded_at=?, thumbnail_path=? WHERE id=?")
                        .bind(fp)
                        .bind(chrono::Utc::now().timestamp())
                        .bind(&thumb)
                        .bind(&video_id)
                        .execute(&pool)
                        .await;
                }
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({"queue_id": queue_id, "status":"done","progress":100.0, "file_path": outcome.final_file}),
                );
                break;
            }

            if attempt < MAX_ATTEMPTS && is_transient_failure(&outcome.stderr_tail) {
                // Clear the failure so the row reads as a fresh attempt, not a
                // dead download the user has to notice and retry by hand.
                let _ = sqlx::query("UPDATE queue_items SET progress=0, speed=NULL, eta=NULL, error=NULL WHERE id=?")
                    .bind(&queue_id)
                    .execute(&pool)
                    .await;
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({"queue_id": queue_id, "status":"downloading", "progress":0.0, "error":""}),
                );
                tokio::time::sleep(retry_delay(attempt)).await;
                match queue_status(&pool, &queue_id).await.as_deref() {
                    Some("downloading") => continue,
                    Some("paused") => {
                        let _ = app.emit(
                            "download-progress",
                            serde_json::json!({"queue_id": queue_id, "status":"paused"}),
                        );
                        break;
                    }
                    Some("cancelled") => {
                        let _ = app.emit(
                            "download-progress",
                            serde_json::json!({"queue_id": queue_id, "status":"cancelled"}),
                        );
                        break;
                    }
                    Some("queued") => {
                        // A resume arrived while this task held the claim, so it
                        // could not spawn on its own. Hand the row to a fresh task
                        // instead of leaving it queued with nobody listening.
                        release(&state, &queue_id);
                        if claim(&state, &queue_id) {
                            spawn_download_with(
                                app, pool, state, queue_id, video_id, url, format_pref, download_dir,
                                ytdlp,
                            );
                        }
                        return;
                    }
                    _ => {
                        release(&state, &queue_id);
                        return;
                    }
                }
            }

            let msg = if outcome.stderr_tail.is_empty() {
                "yt-dlp failed".to_string()
            } else {
                outcome.stderr_tail
            };
            let _ = sqlx::query("UPDATE queue_items SET status='failed', error=?, speed=NULL, eta=NULL WHERE id=?")
                .bind(&msg)
                .bind(&queue_id)
                .execute(&pool)
                .await;
            let _ = app.emit(
                "download-progress",
                serde_json::json!({"queue_id": queue_id, "status":"failed","error": msg}),
            );
            break;
        }
        release(&state, &queue_id);
    });
}

struct RunOutcome {
    success: bool,
    final_file: Option<String>,
    stderr_tail: String,
}

#[allow(clippy::too_many_arguments)]
async fn run_ytdlp<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    pool: &SqlitePool,
    state: &DownloadState,
    queue_id: &str,
    ytdlp: &str,
    format_arg: &str,
    template: &str,
    url: &str,
) -> RunOutcome {
    let mut cmd = tokio::process::Command::new(ytdlp);
    cmd.args([
        "-f",
        format_arg,
        "--newline",
        "--no-update",
        "--js-runtimes",
        "deno",
        "--merge-output-format",
        "mp4",
        "--progress-template",
        r#"{"percent":%(progress._percent)s,"speed":"%(progress.speed)s","eta":"%(progress.eta)s"}"#,
        "--write-thumbnail",
        "--convert-thumbnails",
        "jpg",
        "-o",
        template,
        url,
    ]);
    if let Some(cookies) = crate::db::setting(pool, "cookies_path").await {
        cmd.args(["--cookies", &cookies]);
    }
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            return RunOutcome {
                success: false,
                final_file: None,
                stderr_tail: e.to_string(),
            }
        }
    };

    if let Some(pid) = child.id() {
        state.pids.lock().unwrap().insert(queue_id.to_string(), pid);
    }

    let stderr = child.stderr.take().unwrap();
    let stderr_lines = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
    let stderr_lines2 = stderr_lines.clone();
    let stderr_task = tokio::spawn(async move {
        let mut r = BufReader::new(stderr).lines();
        while let Ok(Some(l)) = r.next_line().await {
            let mut g = stderr_lines2.lock().await;
            g.push(l);
            if g.len() > 20 {
                g.remove(0);
            }
        }
    });

    let stdout = child.stdout.take().unwrap();
    let mut reader = BufReader::new(stdout).lines();
    let mut final_file: Option<String> = None;
    while let Ok(Some(line)) = reader.next_line().await {
        if let Ok(p) = serde_json::from_str::<ProgressPayload>(&line) {
            let percent = p.percent.unwrap_or(0.0);
            let _ = sqlx::query("UPDATE queue_items SET progress=?, speed=?, eta=? WHERE id=?")
                .bind(percent)
                .bind(&p.speed)
                .bind(&p.eta)
                .bind(queue_id)
                .execute(pool)
                .await;
            let _ = app.emit(
                "download-progress",
                serde_json::json!({
                    "queue_id": queue_id, "status":"downloading", "progress": percent, "speed": p.speed, "eta": p.eta
                }),
            );
        }
        if line.contains("Merging formats into") {
            if let Some(path) = line.split("Merging formats into").nth(1) {
                let p = path.trim().trim_matches('"').to_string();
                if !p.is_empty() {
                    final_file = Some(p);
                }
            }
        } else if line.contains("has already been downloaded") {
            let p = line
                .split("has already been downloaded")
                .next()
                .unwrap_or("")
                .trim()
                .trim_start_matches("[download] ")
                .trim()
                .to_string();
            if is_media_path(&p) {
                final_file = Some(p);
            }
        } else if line.contains("Destination:") {
            if let Some(path) = line.split("Destination:").nth(1) {
                let p = path.trim().to_string();
                if is_media_path(&p) {
                    final_file = Some(p);
                }
            }
        }
    }
    let status = child.wait().await;
    // The pipe closes when the child exits, but the reader task may not have
    // been polled yet. Await it or a real 403 looks like an empty error and the
    // retry never fires.
    let _ = stderr_task.await;
    state.pids.lock().unwrap().remove(queue_id);

    let tail = stderr_lines.lock().await.join("\n");
    RunOutcome {
        success: status.map(|s| s.success()).unwrap_or(false),
        final_file,
        stderr_tail: tail,
    }
}

/// Errors worth a fresh extraction. A rejected signature, a rate limit and a
/// dropped connection all clear up on their own; a bad URL or a missing binary
/// will fail the same way three times, so those are not retried.
fn is_transient_failure(stderr: &str) -> bool {
    [
        "HTTP Error 403",
        "HTTP Error 408",
        "HTTP Error 429",
        "HTTP Error 500",
        "HTTP Error 502",
        "HTTP Error 503",
        "HTTP Error 504",
        "timed out",
        "Connection reset",
        "Temporary failure",
        "Remote end closed connection",
    ]
    .iter()
    .any(|needle| stderr.contains(needle))
}

/// Long enough for a rate limit to relax, short enough that the queue still
/// feels alive: 2s, then 4s.
fn retry_delay(attempt: u32) -> std::time::Duration {
    std::time::Duration::from_secs(2 * u64::from(attempt.clamp(1, 3)))
}

/// The library folder the video belongs to, which for a playlist is named after
/// the playlist. None when the video is unfiled.
async fn output_folder(pool: &SqlitePool, video_id: &str) -> Option<String> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT f.name FROM videos v JOIN folders f ON f.id = v.folder_id WHERE v.id = ?",
    )
    .bind(video_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    name.map(|raw| sanitize_folder(&raw))
        .filter(|clean| !clean.is_empty())
}

/// Folder names come from the user, and a slash would silently add a directory
/// level while a leading dot would hide the download in Finder.
fn sanitize_folder(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '\0' => '-',
            other => other,
        })
        .collect();
    cleaned
        .trim()
        .trim_matches('.')
        .trim()
        .chars()
        .take(80)
        .collect()
}

fn is_media_path(p: &str) -> bool {
    [".mp4", ".m4a", ".mp3", ".webm"]
        .iter()
        .any(|ext| p.ends_with(ext))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    async fn insert_video(pool: &SqlitePool, id: &str, file_path: Option<&str>) {
        sqlx::query(
            "INSERT INTO videos (id, title, source, url, file_path, last_position, watched) VALUES (?,?,?,?,?,0,0)",
        )
        .bind(id)
        .bind("Test video")
        .bind("Youtube")
        .bind(format!("https://example.com/{id}"))
        .bind(file_path)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_queue(pool: &SqlitePool, id: &str, video_id: &str, status: &str) {
        sqlx::query("INSERT INTO queue_items (id, video_id, status, created_at) VALUES (?,?,?,0)")
            .bind(id)
            .bind(video_id)
            .bind(status)
            .execute(pool)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn pause_keeps_the_row_and_remove_cleans_it_up() {
        let pool = test_pool().await;
        insert_video(&pool, "v1", None).await;
        insert_queue(&pool, "q1", "v1", "downloading").await;
        let state = DownloadState::new(2);

        pause_download(&pool, &state, "q1".to_string()).await.unwrap();
        assert_eq!(queue_status(&pool, "q1").await.as_deref(), Some("paused"));

        remove_download(&pool, &state, "q1".to_string()).await.unwrap();
        assert!(queue_status(&pool, "q1").await.is_none());
        let video: Option<(String,)> = sqlx::query_as("SELECT id FROM videos WHERE id='v1'")
            .fetch_optional(&pool)
            .await
            .unwrap();
        assert!(video.is_none());
    }

    #[tokio::test]
    async fn remove_keeps_a_downloaded_video() {
        let pool = test_pool().await;
        insert_video(&pool, "v1", Some("/tmp/v1.mp4")).await;
        insert_queue(&pool, "q1", "v1", "done").await;
        let state = DownloadState::new(2);

        remove_download(&pool, &state, "q1".to_string()).await.unwrap();
        let video: Option<(String,)> = sqlx::query_as("SELECT id FROM videos WHERE id='v1'")
            .fetch_optional(&pool)
            .await
            .unwrap();
        assert!(video.is_some());
    }

    #[tokio::test]
    async fn clear_finished_drops_ghosts_and_keeps_files() {
        let pool = test_pool().await;
        insert_video(&pool, "kept", Some("/tmp/kept.mp4")).await;
        insert_video(&pool, "ghost", None).await;
        insert_queue(&pool, "q1", "kept", "done").await;
        insert_queue(&pool, "q2", "ghost", "failed").await;
        insert_queue(&pool, "q3", "ghost", "downloading").await;

        clear_finished_downloads(&pool).await.unwrap();

        let kept: Option<(String,)> = sqlx::query_as("SELECT id FROM videos WHERE id='kept'")
            .fetch_optional(&pool)
            .await
            .unwrap();
        assert!(kept.is_some());
        let ghost: Option<(String,)> = sqlx::query_as("SELECT id FROM videos WHERE id='ghost'")
            .fetch_optional(&pool)
            .await
            .unwrap();
        assert!(ghost.is_some(), "a video with an active queue row must survive");
        let rows: Vec<(String,)> = sqlx::query_as("SELECT id FROM queue_items ORDER BY id")
            .fetch_all(&pool)
            .await
            .unwrap();
        assert_eq!(rows, vec![("q3".to_string(),)]);
    }

    #[tokio::test]
    async fn recover_marks_interrupted_rows_paused() {
        let pool = test_pool().await;
        insert_video(&pool, "v1", None).await;
        insert_queue(&pool, "q1", "v1", "downloading").await;
        insert_queue(&pool, "q2", "v1", "queued").await;
        insert_queue(&pool, "q3", "v1", "done").await;

        recover_interrupted(&pool).await.unwrap();

        assert_eq!(queue_status(&pool, "q1").await.as_deref(), Some("paused"));
        assert_eq!(queue_status(&pool, "q2").await.as_deref(), Some("paused"));
        assert_eq!(queue_status(&pool, "q3").await.as_deref(), Some("done"));
    }

    #[test]
    fn recognises_media_paths() {
        assert!(is_media_path("/tmp/a.mp4"));
        assert!(is_media_path("/tmp/a.m4a"));
        assert!(!is_media_path("/tmp/a.part"));
        assert!(!is_media_path(""));
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_two_video_queue_completes_with_files() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let pool = test_pool().await;
        let state = DownloadState::new(2);
        let dir = std::env::temp_dir().join(format!("yank-live-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let entries = [
            ("v1", "https://www.youtube.com/watch?v=jNQXAC9IVRw"),
            ("v2", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ];
        for (id, url) in entries {
            insert_video(&pool, id, None).await;
            start_download(
                handle.clone(),
                pool.clone(),
                state.clone(),
                id.to_string(),
                url.to_string(),
                "video".to_string(),
                dir.display().to_string(),
            )
            .await
            .unwrap();
        }

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        loop {
            let statuses: Vec<(String,)> =
                sqlx::query_as("SELECT status FROM queue_items ORDER BY created_at, rowid")
                    .fetch_all(&pool)
                    .await
                    .unwrap();
            if statuses.len() == 2 && statuses.iter().all(|s| s.0 == "done") {
                break;
            }
            if std::time::Instant::now() > deadline {
                panic!("downloads did not finish: {statuses:?}");
            }
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
        }

        let files: Vec<(Option<String>,)> =
            sqlx::query_as("SELECT file_path FROM videos ORDER BY id")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(files.len(), 2);
        for (fp,) in files {
            let path = fp.expect("file_path was recorded");
            assert!(std::path::Path::new(&path).exists(), "missing {path}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_pause_then_resume_completes() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let pool = test_pool().await;
        let state = DownloadState::new(1);
        let dir = std::env::temp_dir().join(format!("yank-pause-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        insert_video(&pool, "v1", None).await;

        let queue_id = start_download(
            handle.clone(),
            pool.clone(),
            state.clone(),
            "v1".to_string(),
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ".to_string(),
            "video".to_string(),
            dir.display().to_string(),
        )
        .await
        .unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
        loop {
            let (status, progress): (String, f64) =
                sqlx::query_as("SELECT status, progress FROM queue_items WHERE id=?")
                    .bind(&queue_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            if status == "downloading" && progress > 0.0 {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "never started downloading: {status} {progress}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        pause_download(&pool, &state, queue_id.clone()).await.unwrap();
        assert_eq!(queue_status(&pool, &queue_id).await.as_deref(), Some("paused"));

        resume_download(
            handle.clone(),
            pool.clone(),
            state.clone(),
            queue_id.clone(),
            "video".to_string(),
            dir.display().to_string(),
        )
        .await
        .unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(240);
        loop {
            let status = queue_status(&pool, &queue_id).await;
            if status.as_deref() == Some("done") {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "resume did not finish: {status:?}"
            );
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        let (fp,): (Option<String>,) = sqlx::query_as("SELECT file_path FROM videos WHERE id='v1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        let path = fp.expect("file_path was recorded after resume");
        assert!(std::path::Path::new(&path).exists(), "missing {path}");
        let _ = std::fs::remove_dir_all(&dir);
    }
    /// A shell script that stands in for yt-dlp: it records every invocation,
    /// fails the first `fails` runs with `error`, then reports a merge.
    fn fake_ytdlp(dir: &std::path::Path, fails: u32, error: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let script = dir.join("fake-yt-dlp.sh");
        let body = format!(
            r#"#!/bin/sh
count_file="{dir}/attempts"
args_file="{dir}/args"
out="{dir}/fake.mp4"
printf '%s\n' "$@" > "$args_file"
n=$(cat "$count_file" 2>/dev/null || echo 0)
n=$((n+1))
echo "$n" > "$count_file"
if [ "$n" -le {fails} ]; then
  echo "{error}" >&2
  exit 1
fi
: > "$out"
echo "Merging formats into \"$out\""
exit 0
"#,
            dir = dir.display(),
            fails = fails,
            error = error,
        );
        std::fs::write(&script, body).unwrap();
        let mut perms = std::fs::metadata(&script).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&script, perms).unwrap();
        script.display().to_string()
    }

    async fn wait_for_status(pool: &SqlitePool, queue_id: &str, want: &str) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
        loop {
            let status = queue_status(pool, queue_id).await.unwrap_or_default();
            if status == want {
                return;
            }
            let error: Option<String> =
                sqlx::query_scalar("SELECT error FROM queue_items WHERE id=?")
                    .bind(queue_id)
                    .fetch_optional(pool)
                    .await
                    .ok()
                    .flatten();
            assert!(
                std::time::Instant::now() < deadline,
                "queue never reached {want}, last status {status}, error {error:?}"
            );
            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        }
    }

    /// The exact line all 14 failed rows carried. One retry has to be enough.
    const FORBIDDEN: &str = "ERROR: unable to download video data: HTTP Error 403: Forbidden";

    #[tokio::test]
    async fn a_403_retries_with_a_fresh_extraction_and_finishes() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let pool = test_pool().await;
        let state = DownloadState::new(1);
        let dir = std::env::temp_dir().join(format!("yank-403-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        insert_video(&pool, "v1", None).await;
        sqlx::query("INSERT INTO folders (id, name, created_at) VALUES ('f1','Systems/Design 3.0',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE videos SET folder_id='f1' WHERE id='v1'")
            .execute(&pool)
            .await
            .unwrap();
        insert_queue(&pool, "q1", "v1", "queued").await;
        claim(&state, "q1");

        spawn_download_with(
            handle,
            pool.clone(),
            state.clone(),
            "q1".to_string(),
            "v1".to_string(),
            "https://example.com/v1".to_string(),
            "video".to_string(),
            dir.display().to_string(),
            fake_ytdlp(&dir, 1, FORBIDDEN),
        );

        wait_for_status(&pool, "q1", "done").await;
        let attempts = std::fs::read_to_string(dir.join("attempts")).unwrap();
        assert_eq!(attempts.trim(), "2", "a 403 must be retried exactly once here");
        let (fp,): (Option<String>,) = sqlx::query_as("SELECT file_path FROM videos WHERE id='v1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fp.unwrap(), dir.join("fake.mp4").display().to_string());

        // The library folder, not the channel, decides where the file lands.
        let args = std::fs::read_to_string(dir.join("args")).unwrap();
        let mut lines = args.lines();
        let template = lines
            .by_ref()
            .position(|arg| arg == "-o")
            .map(|_| lines.next().unwrap())
            .expect("the fake was called with -o");
        assert_eq!(
            template,
            format!(
                "{}/Systems-Design 3.0/%(title)s [%(id)s].mp4",
                dir.display()
            )
        );
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn a_permanent_error_fails_after_one_attempt() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let pool = test_pool().await;
        let state = DownloadState::new(1);
        let dir = std::env::temp_dir().join(format!("yank-perm-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        insert_video(&pool, "v1", None).await;
        insert_queue(&pool, "q1", "v1", "queued").await;
        claim(&state, "q1");

        spawn_download_with(
            handle,
            pool.clone(),
            state,
            "q1".to_string(),
            "v1".to_string(),
            "https://example.com/v1".to_string(),
            "video".to_string(),
            dir.display().to_string(),
            fake_ytdlp(&dir, 99, "ERROR: [youtube] Unsupported URL: https://example.com/v1"),
        );

        wait_for_status(&pool, "q1", "failed").await;
        let attempts = std::fs::read_to_string(dir.join("attempts")).unwrap();
        assert_eq!(attempts.trim(), "1", "a bad URL will fail the same way every time");
        let (error,): (Option<String>,) =
            sqlx::query_as("SELECT error FROM queue_items WHERE id='q1'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(error.unwrap().contains("Unsupported URL"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    fn attempts(dir: &std::path::Path) -> u32 {
        std::fs::read_to_string(dir.join("attempts"))
            .ok()
            .and_then(|raw| raw.trim().parse().ok())
            .unwrap_or(0)
    }

    async fn wait_for_first_attempt(dir: &std::path::Path) {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        while attempts(dir) < 1 {
            assert!(
                std::time::Instant::now() < deadline,
                "the fake yt-dlp was never called"
            );
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        // Land inside the 2s backoff instead of racing the first attempt.
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
    }

    #[tokio::test]
    async fn pausing_during_the_retry_backoff_stops_the_retry() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let pool = test_pool().await;
        let state = DownloadState::new(1);
        let dir = std::env::temp_dir().join(format!("yank-pause-403-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        insert_video(&pool, "v1", None).await;
        insert_queue(&pool, "q1", "v1", "queued").await;
        claim(&state, "q1");

        spawn_download_with(
            handle,
            pool.clone(),
            state.clone(),
            "q1".to_string(),
            "v1".to_string(),
            "https://example.com/v1".to_string(),
            "video".to_string(),
            dir.display().to_string(),
            fake_ytdlp(&dir, 1, FORBIDDEN),
        );

        wait_for_first_attempt(&dir).await;
        pause_download(&pool, &state, "q1".to_string()).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(2500)).await;

        assert_eq!(queue_status(&pool, "q1").await.as_deref(), Some("paused"));
        assert_eq!(attempts(&dir), 1, "a paused download must not keep retrying");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn resuming_during_the_retry_backoff_requeues_the_row() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let pool = test_pool().await;
        let state = DownloadState::new(1);
        let dir = std::env::temp_dir().join(format!("yank-resume-403-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        insert_video(&pool, "v1", None).await;
        insert_queue(&pool, "q1", "v1", "queued").await;
        claim(&state, "q1");

        spawn_download_with(
            handle.clone(),
            pool.clone(),
            state.clone(),
            "q1".to_string(),
            "v1".to_string(),
            "https://example.com/v1".to_string(),
            "video".to_string(),
            dir.display().to_string(),
            fake_ytdlp(&dir, 1, FORBIDDEN),
        );

        wait_for_first_attempt(&dir).await;
        // Pause and resume while the first task still holds the claim, which is
        // exactly the window where resume cannot spawn a replacement itself.
        pause_download(&pool, &state, "q1".to_string()).await.unwrap();
        resume_download(
            handle,
            pool.clone(),
            state.clone(),
            "q1".to_string(),
            "video".to_string(),
            dir.display().to_string(),
        )
        .await
        .unwrap();

        wait_for_status(&pool, "q1", "done").await;
        assert_eq!(attempts(&dir), 2, "the second attempt must pick up the row");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_transient_failures_are_retried() {
        assert!(is_transient_failure(FORBIDDEN));
        assert!(is_transient_failure("ERROR: HTTP Error 503: Service Unavailable"));
        assert!(is_transient_failure("ERROR: Connection reset by peer"));
        assert!(!is_transient_failure(
            "ERROR: [youtube] Unsupported URL: https://example.com"
        ));
        assert!(!is_transient_failure(
            "ERROR: unable to download video data: HTTP Error 404: Not Found"
        ));
        assert!(!is_transient_failure(""));
    }

    #[test]
    fn retry_backoff_waits_longer_each_round() {
        assert_eq!(retry_delay(1), std::time::Duration::from_secs(2));
        assert_eq!(retry_delay(2), std::time::Duration::from_secs(4));
        assert_eq!(retry_delay(3), std::time::Duration::from_secs(6));
    }

    #[test]
    fn folder_names_cannot_escape_or_hide() {
        assert_eq!(sanitize_folder("Systems Design 3.0"), "Systems Design 3.0");
        assert_eq!(sanitize_folder("a/b:c\\d"), "a-b-c-d");
        assert_eq!(sanitize_folder("  .hidden.  "), "hidden");
        assert_eq!(sanitize_folder("   "), "");
        assert_eq!(sanitize_folder(&"x".repeat(120)).len(), 80);
    }

    #[tokio::test]
    async fn a_filed_video_downloads_into_its_library_folder() {
        let pool = test_pool().await;
        insert_video(&pool, "filed", None).await;
        insert_video(&pool, "loose", None).await;
        sqlx::query("INSERT INTO folders (id, name, created_at) VALUES ('f1','Systems/Design 3.0',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE videos SET folder_id='f1' WHERE id='filed'")
            .execute(&pool)
            .await
            .unwrap();

        assert_eq!(
            output_folder(&pool, "filed").await.as_deref(),
            Some("Systems-Design 3.0")
        );
        assert_eq!(output_folder(&pool, "loose").await, None);
        assert_eq!(output_folder(&pool, "missing").await, None);
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_filed_video_lands_in_the_playlist_folder() {
        let app = tauri::test::mock_app();
        let handle = app.handle().clone();
        let pool = test_pool().await;
        let state = DownloadState::new(1);
        let dir = std::env::temp_dir().join(format!("yank-folder-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        insert_video(&pool, "v1", None).await;
        sqlx::query("INSERT INTO folders (id, name, created_at) VALUES ('f1','Systems Design 3.0',0)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("UPDATE videos SET folder_id='f1' WHERE id='v1'")
            .execute(&pool)
            .await
            .unwrap();

        let queue_id = start_download(
            handle,
            pool.clone(),
            state,
            "v1".to_string(),
            "https://www.youtube.com/watch?v=jNQXAC9IVRw".to_string(),
            "video".to_string(),
            dir.display().to_string(),
        )
        .await
        .unwrap();

        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(180);
        loop {
            let status = queue_status(&pool, &queue_id).await;
            if status.as_deref() == Some("done") {
                break;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "download did not finish: {status:?}"
            );
            tokio::time::sleep(std::time::Duration::from_secs(1)).await;
        }

        let (fp,): (Option<String>,) = sqlx::query_as("SELECT file_path FROM videos WHERE id='v1'")
            .fetch_one(&pool)
            .await
            .unwrap();
        let path = fp.expect("file_path was recorded");
        assert!(
            std::path::Path::new(&path).starts_with(dir.join("Systems Design 3.0")),
            "expected the playlist folder, got {path}"
        );
        assert!(std::path::Path::new(&path).exists(), "missing {path}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
