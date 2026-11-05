//! The `queue_items` table: one row per download attempt.
//!
//! The row's `status` is the single source of truth for what the user wants.
//! Pause and cancel only write the status (and kill the process); the worker
//! reads it back after every yt-dlp run to decide what to do next. See
//! `downloads::worker`.

use super::now;
use crate::error::{AppError, AppResult};
use crate::models::{Format, QueueEntry, QueueStatus};
use sqlx::SqlitePool;

/// Everything the worker needs to run one download.
#[derive(Debug, Clone, PartialEq)]
pub struct Job {
    pub queue_id: String,
    pub video_id: String,
    pub url: String,
    pub format: Format,
}

/// Statuses that still own a worker (or will get one).
const ACTIVE: &str = "('queued', 'downloading', 'paused')";
/// Statuses with a yt-dlp process running or about to start.
const RUNNING: &str = "('queued', 'downloading')";
const FINISHED: &str = "('done', 'failed', 'cancelled')";

/// Create a queued row and return the job to run.
pub async fn insert(pool: &SqlitePool, video_id: &str, url: &str, format: Format) -> AppResult<Job> {
    let queue_id = uuid::Uuid::new_v4().to_string();
    sqlx::query(
        "INSERT INTO queue_items (id, video_id, status, format, created_at) \
         VALUES (?, ?, 'queued', ?, ?)",
    )
    .bind(&queue_id)
    .bind(video_id)
    .bind(format.as_str())
    .bind(now())
    .execute(pool)
    .await?;
    Ok(Job {
        queue_id,
        video_id: video_id.to_string(),
        url: url.to_string(),
        format,
    })
}

/// The columns of a [`QueueEntry`], joined from its video and playlist.
const ENTRY_SELECT: &str =
    "SELECT q.id, q.video_id, q.status, q.progress, q.speed, q.eta, q.error, q.created_at, \
            q.format, v.title, v.url, v.source, v.playlist_id, \
            p.title AS playlist_title, v.playlist_index \
     FROM queue_items q \
     JOIN videos v ON v.id = q.video_id \
     LEFT JOIN playlists p ON p.id = v.playlist_id";

/// Rows for the Downloads view, oldest first.
pub async fn list(pool: &SqlitePool) -> AppResult<Vec<QueueEntry>> {
    let sql = format!("{ENTRY_SELECT} ORDER BY q.created_at, q.rowid");
    Ok(sqlx::query_as(&sql).fetch_all(pool).await?)
}

pub async fn get(pool: &SqlitePool, queue_id: &str) -> AppResult<QueueEntry> {
    let sql = format!("{ENTRY_SELECT} WHERE q.id = ?");
    sqlx::query_as(&sql)
        .bind(queue_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::user("That download no longer exists."))
}

/// None when the row was removed.
pub async fn status(pool: &SqlitePool, queue_id: &str) -> Option<QueueStatus> {
    sqlx::query_scalar("SELECT status FROM queue_items WHERE id = ?")
        .bind(queue_id)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten()
}

/// Ids of every row in one status, oldest first.
pub async fn ids_with_status(pool: &SqlitePool, status: QueueStatus) -> AppResult<Vec<String>> {
    Ok(
        sqlx::query_scalar("SELECT id FROM queue_items WHERE status = ? ORDER BY created_at, rowid")
            .bind(status)
            .fetch_all(pool)
            .await?,
    )
}

/// True when this video already has a download that is not finished.
pub async fn has_active(pool: &SqlitePool, video_id: &str) -> AppResult<bool> {
    let sql = format!("SELECT 1 FROM queue_items WHERE video_id = ? AND status IN {ACTIVE}");
    let found: Option<i64> = sqlx::query_scalar(&sql)
        .bind(video_id)
        .fetch_optional(pool)
        .await?;
    Ok(found.is_some())
}

/// True while a yt-dlp process for this video is running or about to start.
pub async fn is_running(pool: &SqlitePool, video_id: &str) -> AppResult<bool> {
    let sql = format!("SELECT 1 FROM queue_items WHERE video_id = ? AND status IN {RUNNING}");
    let found: Option<i64> = sqlx::query_scalar(&sql)
        .bind(video_id)
        .fetch_optional(pool)
        .await?;
    Ok(found.is_some())
}

/// Write a new status and clear the live counters. `from` limits which
/// statuses may be overwritten, so a late pause cannot undo a "done".
/// Returns false when the row was not in one of those statuses.
pub async fn transition(
    pool: &SqlitePool,
    queue_id: &str,
    from: &[QueueStatus],
    to: QueueStatus,
) -> AppResult<bool> {
    let sql = format!(
        "UPDATE queue_items SET status = ?, speed = NULL, eta = NULL WHERE id = ? AND status IN ({})",
        super::placeholders(from.len())
    );
    let mut query = sqlx::query(&sql).bind(to).bind(queue_id);
    for status in from {
        query = query.bind(*status);
    }
    let result = query.execute(pool).await?;
    Ok(result.rows_affected() > 0)
}

/// Put a paused or failed row back in line and return its job. Any other
/// status is refused: requeueing a running row would throw away its result,
/// and requeueing a done one would download it again. Also refused while
/// another row of the same video is active (the URL was pasted again), since
/// two yt-dlp runs would write the same file.
pub async fn requeue(pool: &SqlitePool, queue_id: &str, fallback: Format) -> AppResult<Job> {
    let row: Option<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT q.video_id, v.url, q.format FROM queue_items q \
         JOIN videos v ON v.id = q.video_id WHERE q.id = ?",
    )
    .bind(queue_id)
    .fetch_optional(pool)
    .await?;
    let (video_id, url, format) =
        row.ok_or_else(|| AppError::user("That download no longer exists."))?;
    let sql = format!(
        "UPDATE queue_items SET status = 'queued', error = NULL, speed = NULL, eta = NULL \
         WHERE id = ? AND status IN ('paused', 'failed') AND NOT EXISTS \
         (SELECT 1 FROM queue_items other WHERE other.video_id = queue_items.video_id \
          AND other.id != queue_items.id AND other.status IN {ACTIVE})"
    );
    let result = sqlx::query(&sql).bind(queue_id).execute(pool).await?;
    if result.rows_affected() == 0 {
        return Err(AppError::user(match status(pool, queue_id).await {
            Some(QueueStatus::Paused | QueueStatus::Failed) => {
                "This video is already downloading from another row in the queue."
            }
            _ => "Only paused or failed downloads can be resumed.",
        }));
    }
    Ok(Job {
        queue_id: queue_id.to_string(),
        video_id,
        url,
        format: format.map_or(fallback, |raw| Format::parse(Some(&raw))),
    })
}

pub async fn set_progress(
    pool: &SqlitePool,
    queue_id: &str,
    percent: f64,
    speed: Option<&str>,
    eta: Option<&str>,
) -> AppResult<()> {
    sqlx::query("UPDATE queue_items SET progress = ?, speed = ?, eta = ? WHERE id = ?")
        .bind(percent)
        .bind(speed)
        .bind(eta)
        .bind(queue_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Mark a running row done. Returns false when the user changed the row
/// since the worker last looked (a cancel or pause that landed during the
/// final moments); their choice wins.
pub async fn mark_done(pool: &SqlitePool, queue_id: &str) -> AppResult<bool> {
    let result = sqlx::query(
        "UPDATE queue_items SET status = 'done', progress = 100, speed = NULL, eta = NULL, \
         error = NULL WHERE id = ? AND status = 'downloading'",
    )
    .bind(queue_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Mark a running row failed. Returns false when the user changed the row
/// meanwhile, for instance a Retry that requeued it: overwriting that with
/// "failed" would silently drop the retry.
pub async fn mark_failed(pool: &SqlitePool, queue_id: &str, error: &str) -> AppResult<bool> {
    let result = sqlx::query(
        "UPDATE queue_items SET status = 'failed', error = ?, speed = NULL, eta = NULL \
         WHERE id = ? AND status = 'downloading'",
    )
    .bind(error)
    .bind(queue_id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// Clear the counters before an automatic retry, so the row reads as a fresh
/// attempt rather than a dead download.
pub async fn reset_for_retry(pool: &SqlitePool, queue_id: &str) -> AppResult<()> {
    sqlx::query(
        "UPDATE queue_items SET progress = 0, speed = NULL, eta = NULL, error = NULL WHERE id = ?",
    )
    .bind(queue_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Delete a queue row. A video that was never downloaded disappears with it,
/// so removing a download does not leave a dead card in the library. A video
/// that was downloaded once and lost its file is kept: it has a watch
/// history and a folder, and the card offers Download.
pub async fn remove(pool: &SqlitePool, queue_id: &str) -> AppResult<()> {
    let video_id: Option<String> =
        sqlx::query_scalar("SELECT video_id FROM queue_items WHERE id = ?")
            .bind(queue_id)
            .fetch_optional(pool)
            .await?;
    sqlx::query("DELETE FROM queue_items WHERE id = ?")
        .bind(queue_id)
        .execute(pool)
        .await?;
    if let Some(video_id) = video_id {
        delete_if_never_downloaded(pool, &video_id).await?;
    }
    Ok(())
}

/// Delete every finished row, and the videos among them that never got a file.
pub async fn clear_finished(pool: &SqlitePool) -> AppResult<()> {
    let sql = format!("SELECT DISTINCT video_id FROM queue_items WHERE status IN {FINISHED}");
    let video_ids: Vec<String> = sqlx::query_scalar(&sql).fetch_all(pool).await?;
    sqlx::query(&format!("DELETE FROM queue_items WHERE status IN {FINISHED}"))
        .execute(pool)
        .await?;
    for video_id in video_ids {
        delete_if_never_downloaded(pool, &video_id).await?;
    }
    Ok(())
}

async fn delete_if_never_downloaded(pool: &SqlitePool, video_id: &str) -> AppResult<()> {
    let sql = format!(
        "DELETE FROM videos WHERE id = ? AND file_path IS NULL AND downloaded_at IS NULL AND NOT EXISTS \
         (SELECT 1 FROM queue_items WHERE video_id = ? AND status IN {ACTIVE})"
    );
    sqlx::query(&sql).bind(video_id).bind(video_id).execute(pool).await?;
    Ok(())
}

/// A download running when the app quit cannot still be running. Park it as
/// paused so the user decides when it continues.
pub async fn recover_interrupted(pool: &SqlitePool) -> AppResult<()> {
    let sql = format!(
        "UPDATE queue_items SET status = 'paused', speed = NULL, eta = NULL WHERE status IN {RUNNING}"
    );
    sqlx::query(&sql).execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::{count, queue_row, video};
    use crate::db::test_pool;
    use QueueStatus::*;

    #[tokio::test]
    async fn insert_then_list_joins_the_video() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        let job = insert(&pool, "v1", "https://example.com/v1", Format::Audio).await.unwrap();
        let entry = get(&pool, &job.queue_id).await.unwrap();
        assert_eq!(entry.status, Queued);
        assert_eq!(entry.title, "Video v1");
        assert_eq!(entry.format.as_deref(), Some("audio"));
        assert!(has_active(&pool, "v1").await.unwrap());
    }

    #[tokio::test]
    async fn running_means_queued_or_downloading_not_paused() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        let job = insert(&pool, "v1", "https://example.com/v1", Format::Video).await.unwrap();
        assert!(is_running(&pool, "v1").await.unwrap());
        transition(&pool, &job.queue_id, &[Queued], Paused).await.unwrap();
        assert!(!is_running(&pool, "v1").await.unwrap());
        assert!(has_active(&pool, "v1").await.unwrap(), "paused still owns the video");
        assert!(get(&pool, "missing").await.is_err());
    }

    #[tokio::test]
    async fn transitions_only_apply_from_allowed_states() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        queue_row(&pool, "q1", "v1", "done").await;
        assert!(!transition(&pool, "q1", &[Queued, Downloading], Paused).await.unwrap());
        assert_eq!(status(&pool, "q1").await, Some(Done));
    }

    #[tokio::test]
    async fn requeue_keeps_the_original_format() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        let job = insert(&pool, "v1", "u", Format::Audio).await.unwrap();
        transition(&pool, &job.queue_id, &[Queued], Downloading).await.unwrap();
        assert!(mark_failed(&pool, &job.queue_id, "boom").await.unwrap());

        let again = requeue(&pool, &job.queue_id, Format::Video).await.unwrap();
        assert_eq!(again.format, Format::Audio);
        let entry = get(&pool, &job.queue_id).await.unwrap();
        assert_eq!((entry.status, entry.error), (Queued, None));

        // Rows from before the format column fall back to the current default.
        video(&pool, "v2", None).await;
        queue_row(&pool, "old", "v2", "paused").await;
        assert_eq!(requeue(&pool, "old", Format::Original).await.unwrap().format, Format::Original);
    }

    /// Regression: resume on a running or finished row forced it back to
    /// queued, discarding a running download's result or re-running a done one.
    #[tokio::test]
    async fn only_paused_or_failed_rows_can_be_requeued() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        for status in ["queued", "downloading", "done", "cancelled"] {
            queue_row(&pool, status, "v1", status).await;
            assert!(requeue(&pool, status, Format::Video).await.is_err(), "{status}");
        }
        assert_eq!(status(&pool, "downloading").await, Some(Downloading));
    }

    /// Regression: retrying a failed row while the same video had been queued
    /// again ran two yt-dlp processes on one output file.
    #[tokio::test]
    async fn requeue_refuses_while_the_same_video_is_active_elsewhere() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        queue_row(&pool, "old", "v1", "failed").await;
        queue_row(&pool, "new", "v1", "queued").await;
        let error = requeue(&pool, "old", Format::Video).await.unwrap_err().to_string();
        assert!(error.contains("already downloading"), "{error}");
        assert_eq!(status(&pool, "old").await, Some(Failed));

        transition(&pool, "new", &[Queued], Done).await.unwrap();
        assert!(requeue(&pool, "old", Format::Video).await.is_ok(), "free again once the other row is done");
    }

    /// Regression: an unknown status ('pending', the first schema's default)
    /// made the whole queue fail to decode.
    #[tokio::test]
    async fn unknown_statuses_are_parked_as_paused() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        queue_row(&pool, "legacy", "v1", "pending").await;
        assert!(list(&pool).await.is_err(), "the bug: one bad row breaks the list");
        sqlx::raw_sql(include_str!("../../migrations/20261104010000_queue_status_cleanup.sql"))
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].status, Paused);
    }

    /// Regression: the worker's final write overwrote a cancel or a retry
    /// that landed after it last read the row.
    #[tokio::test]
    async fn final_writes_never_overwrite_the_users_choice() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        queue_row(&pool, "cancelled", "v1", "cancelled").await;
        assert!(!mark_done(&pool, "cancelled").await.unwrap());
        assert_eq!(status(&pool, "cancelled").await, Some(Cancelled));

        queue_row(&pool, "retried", "v1", "queued").await;
        assert!(!mark_failed(&pool, "retried", "boom").await.unwrap());
        assert_eq!(status(&pool, "retried").await, Some(Queued));
    }

    #[tokio::test]
    async fn removing_a_row_drops_a_video_that_never_downloaded() {
        let pool = test_pool().await;
        video(&pool, "ghost", None).await;
        video(&pool, "kept", Some("/tmp/kept.mp4")).await;
        queue_row(&pool, "q1", "ghost", "paused").await;
        queue_row(&pool, "q2", "kept", "done").await;

        remove(&pool, "q1").await.unwrap();
        remove(&pool, "q2").await.unwrap();
        assert_eq!(count(&pool, "queue_items").await, 0);
        let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM videos").fetch_all(&pool).await.unwrap();
        assert_eq!(ids, vec!["kept"]);
    }

    #[tokio::test]
    async fn clear_finished_spares_active_rows_and_their_videos() {
        let pool = test_pool().await;
        video(&pool, "kept", Some("/tmp/kept.mp4")).await;
        video(&pool, "ghost", None).await;
        queue_row(&pool, "q1", "kept", "done").await;
        queue_row(&pool, "q2", "ghost", "failed").await;
        queue_row(&pool, "q3", "ghost", "downloading").await;

        clear_finished(&pool).await.unwrap();
        let rows: Vec<String> = sqlx::query_scalar("SELECT id FROM queue_items").fetch_all(&pool).await.unwrap();
        assert_eq!(rows, vec!["q3"]);
        assert_eq!(count(&pool, "videos").await, 2, "ghost still has an active row");
    }

    /// Regression: a downloaded video whose file was deleted in Finder lost its
    /// library entry (watch state, folder) on "Clear finished".
    #[tokio::test]
    async fn cleanup_keeps_a_video_that_was_downloaded_once() {
        let pool = test_pool().await;
        video(&pool, "watched", None).await;
        sqlx::query("UPDATE videos SET downloaded_at = 1, watched = 1 WHERE id = 'watched'")
            .execute(&pool)
            .await
            .unwrap();
        queue_row(&pool, "q-done", "watched", "done").await;
        queue_row(&pool, "q-again", "watched", "cancelled").await;

        clear_finished(&pool).await.unwrap();
        assert_eq!(count(&pool, "videos").await, 1, "clear finished");
        queue_row(&pool, "q-third", "watched", "paused").await;
        remove(&pool, "q-third").await.unwrap();
        assert_eq!(count(&pool, "videos").await, 1, "remove");
    }

    #[tokio::test]
    async fn recovery_parks_interrupted_rows() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        queue_row(&pool, "q1", "v1", "downloading").await;
        queue_row(&pool, "q2", "v1", "queued").await;
        queue_row(&pool, "q3", "v1", "done").await;
        recover_interrupted(&pool).await.unwrap();
        assert_eq!(status(&pool, "q1").await, Some(Paused));
        assert_eq!(status(&pool, "q2").await, Some(Paused));
        assert_eq!(status(&pool, "q3").await, Some(Done));
        assert_eq!(ids_with_status(&pool, Paused).await.unwrap(), vec!["q1", "q2"]);
    }
}
