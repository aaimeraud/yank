use crate::db::DbState;
use crate::util::find_ytdlp;
use serde::Deserialize;
use serde_json::Value;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
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
}

impl DownloadState {
    pub fn new(concurrency: usize) -> Self {
        Self {
            sem: Arc::new(Semaphore::new(concurrency)),
            pids: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub async fn cancel_download(
    pool: &SqlitePool,
    state: &DownloadState,
    queue_id: String,
) -> Result<(), String> {
    sqlx::query("UPDATE queue_items SET status='cancelled' WHERE id=? AND status IN ('queued','downloading')")
        .bind(&queue_id).execute(pool).await.map_err(|e| e.to_string())?;
    if let Some(pid) = state.pids.lock().unwrap().get(&queue_id).copied() {
        let _ = std::process::Command::new("kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }
    Ok(())
}

async fn queue_status(pool: &SqlitePool, queue_id: &str) -> Option<String> {
    let row: Option<(String,)> = sqlx::query_as("SELECT status FROM queue_items WHERE id=?")
        .bind(queue_id)
        .fetch_optional(pool)
        .await
        .ok()?;
    row.map(|r| r.0)
}

pub async fn start_download(
    app: tauri::AppHandle,
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
        .bind(&queue_id).bind(&video_id).bind("queued").bind(now)
        .execute(&pool).await.map_err(|e| e.to_string())?;

    let format_arg = match format_pref.as_str() {
        "audio" => "bestaudio[ext=m4a]/bestaudio".to_string(),
        "original" => "best".to_string(),
        _ => "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best".to_string(),
    };
    let ext = if format_pref == "audio" { "m4a" } else { "mp4" };
    let template = format!("{}/%(playlist_title|channel|uploader)s/%(title)s [%(id)s].{}", download_dir, ext);

    let app2 = app.clone();
    let pool2 = pool.clone();
    let queue_id_ret = queue_id.clone();
    tokio::spawn(async move {
        let _permit = match state.sem.clone().acquire_owned().await {
            Ok(p) => p,
            Err(_) => return,
        };

        // Cancelled while waiting in the queue: nothing to do.
        if queue_status(&pool2, &queue_id).await.as_deref() != Some("queued") {
            return;
        }
        let _ = sqlx::query("UPDATE queue_items SET status='downloading' WHERE id=?")
            .bind(&queue_id).execute(&pool2).await;

        let ytdlp = find_ytdlp();
        let mut cmd = Command::new(&ytdlp);
        cmd.args([
            "-f", &format_arg,
            "--newline",
            "--no-update",
            "--js-runtimes", "deno",
            "--merge-output-format", "mp4",
            "--progress-template", r#"{"percent":%(progress._percent)s,"speed":"%(progress.speed)s","eta":"%(progress.eta)s"}"#,
            "--write-thumbnail", "--convert-thumbnails", "jpg",
            "-o", &template,
            &url,
        ]);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                let _ = sqlx::query("UPDATE queue_items SET status='failed', error=? WHERE id=?")
                    .bind(e.to_string()).bind(&queue_id).execute(&pool2).await;
                let _ = app2.emit("download-progress", serde_json::json!({"queue_id": queue_id, "status":"failed","error": e.to_string()}));
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
                if g.len() > 20 { g.remove(0); }
            }
        });

        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout).lines();
        let mut final_file: Option<String> = None;
        while let Ok(Some(line)) = reader.next_line().await {
            if let Ok(p) = serde_json::from_str::<ProgressPayload>(&line) {
                let percent = p.percent.unwrap_or(0.0);
                let _ = sqlx::query("UPDATE queue_items SET progress=?, speed=?, eta=? WHERE id=?")
                    .bind(percent).bind(&p.speed).bind(&p.eta).bind(&queue_id).execute(&pool2).await;
                let _ = app2.emit("download-progress", serde_json::json!({
                    "queue_id": queue_id, "status":"downloading", "progress": percent, "speed": p.speed, "eta": p.eta
                }));
            }
            if line.contains("Merging formats into") {
                if let Some(path) = line.split("Merging formats into").nth(1) {
                    let p = path.trim().trim_matches('"').to_string();
                    if !p.is_empty() { final_file = Some(p); }
                }
            } else if line.contains("Destination:") {
                if let Some(path) = line.split("Destination:").nth(1) {
                    let p = path.trim().to_string();
                    if p.ends_with(".mp4") || p.ends_with(".m4a") || p.ends_with(".mp3") || p.ends_with(".webm") {
                        final_file = Some(p);
                    }
                }
            }
        }
        let status = child.wait().await;
        state.pids.lock().unwrap().remove(&queue_id);

        let success = status.map(|s| s.success()).unwrap_or(false);
        let cancelled = queue_status(&pool2, &queue_id).await.as_deref() == Some("cancelled");
        if success && !cancelled {
            let _ = sqlx::query("UPDATE queue_items SET status='done', progress=100 WHERE id=?")
                .bind(&queue_id).execute(&pool2).await;
            if let Some(fp) = &final_file {
                let thumb = crate::util::find_thumbnail(fp);
                let _ = sqlx::query("UPDATE videos SET file_path=?, downloaded_at=?, thumbnail_path=? WHERE id=?")
                    .bind(fp).bind(chrono::Utc::now().timestamp()).bind(&thumb).bind(&video_id).execute(&pool2).await;
            }
            let _ = app2.emit("download-progress", serde_json::json!({"queue_id": queue_id, "status":"done","progress":100.0, "file_path": final_file}));
        } else if cancelled {
            let _ = app2.emit("download-progress", serde_json::json!({"queue_id": queue_id, "status":"cancelled"}));
        } else {
            let tail = stderr_lines.lock().await.join("\n");
            let msg = if tail.is_empty() { "yt-dlp failed".to_string() } else { tail };
            let _ = sqlx::query("UPDATE queue_items SET status='failed', error=? WHERE id=?")
                .bind(&msg).bind(&queue_id).execute(&pool2).await;
            let _ = app2.emit("download-progress", serde_json::json!({"queue_id": queue_id, "status":"failed","error": msg}));
        }
    });

    Ok(queue_id_ret)
}