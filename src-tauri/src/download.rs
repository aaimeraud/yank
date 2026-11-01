use crate::util::find_ytdlp;
use serde::Deserialize;
use sqlx::SqlitePool;
use std::collections::{HashMap, HashSet};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
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
    let format_arg = match format_pref.as_str() {
        "audio" => "bestaudio[ext=m4a]/bestaudio".to_string(),
        "original" => "best".to_string(),
        _ => "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".to_string(),
    };
    let ext = if format_pref == "audio" { "m4a" } else { "mp4" };
    let template = format!(
        "{}/%(playlist_title|channel|uploader)s/%(title)s [%(id)s].{}",
        download_dir, ext
    );

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

        let ytdlp = find_ytdlp();
        let mut cmd = Command::new(&ytdlp);
        cmd.args([
            "-f",
            &format_arg,
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
            &template,
            &url,
        ]);
        if let Some(cookies) = crate::db::setting(&pool, "cookies_path").await {
            cmd.args(["--cookies", &cookies]);
        }
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = sqlx::query("UPDATE queue_items SET status='failed', error=? WHERE id=?")
                    .bind(e.to_string())
                    .bind(&queue_id)
                    .execute(&pool)
                    .await;
                let _ = app.emit(
                    "download-progress",
                    serde_json::json!({"queue_id": queue_id, "status":"failed","error": e.to_string()}),
                );
                release(&state, &queue_id);
                return;
            }
        };

        if let Some(pid) = child.id() {
            state.pids.lock().unwrap().insert(queue_id.clone(), pid);
        }

        let stderr = child.stderr.take().unwrap();
        let stderr_lines = std::sync::Arc::new(tokio::sync::Mutex::new(Vec::<String>::new()));
        let stderr_lines2 = stderr_lines.clone();
        tokio::spawn(async move {
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
                    .bind(&queue_id)
                    .execute(&pool)
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
        state.pids.lock().unwrap().remove(&queue_id);

        let current = queue_status(&pool, &queue_id).await;
        let Some(current) = current else {
            release(&state, &queue_id);
            return;
        };
        let success = status.map(|s| s.success()).unwrap_or(false);

        if current == "cancelled" {
            let _ = app.emit(
                "download-progress",
                serde_json::json!({"queue_id": queue_id, "status":"cancelled"}),
            );
        } else if success {
            let _ = sqlx::query("UPDATE queue_items SET status='done', progress=100, speed=NULL, eta=NULL WHERE id=?")
                .bind(&queue_id)
                .execute(&pool)
                .await;
            if let Some(fp) = &final_file {
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
                serde_json::json!({"queue_id": queue_id, "status":"done","progress":100.0, "file_path": final_file}),
            );
        } else if current == "paused" {
            let _ = app.emit(
                "download-progress",
                serde_json::json!({"queue_id": queue_id, "status":"paused"}),
            );
        } else if current == "queued" {
            // Resume arrived while the old process was still exiting. Requeue it.
            release(&state, &queue_id);
            if claim(&state, &queue_id) {
                spawn_download(
                    app,
                    pool,
                    state,
                    queue_id,
                    video_id,
                    url,
                    format_pref,
                    download_dir,
                );
            }
            return;
        } else {
            let tail = stderr_lines.lock().await.join("\n");
            let msg = if tail.is_empty() {
                "yt-dlp failed".to_string()
            } else {
                tail
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
        }
        release(&state, &queue_id);
    });
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
}
