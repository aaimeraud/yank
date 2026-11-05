//! The `videos` table: the library.

use super::{now, placeholders, MAX_BINDS};
use crate::error::{AppError, AppResult};
use crate::models::Video;
use sqlx::SqlitePool;
use std::path::Path;

const COLUMNS: &str = "id, title, uploader, duration, thumbnail_path, source, url, file_path, \
     file_size, downloaded_at, last_position, watched, playlist_id, folder_id, playlist_index";

/// Newest download first; rows still downloading (no date yet) sort last.
pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Video>> {
    let sql = format!("SELECT {COLUMNS} FROM videos ORDER BY downloaded_at DESC");
    let mut videos: Vec<Video> = sqlx::query_as(&sql).fetch_all(pool).await?;
    for video in &mut videos {
        backfill_thumbnail(pool, video).await;
    }
    Ok(videos)
}

pub async fn get(pool: &SqlitePool, id: &str) -> AppResult<Video> {
    let sql = format!("SELECT {COLUMNS} FROM videos WHERE id = ?");
    sqlx::query_as(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::user("Video not found."))
}

/// The thumbnail is written next to the video but can arrive after the row
/// is marked done (yt-dlp converts it last). Look once more when listing.
async fn backfill_thumbnail(pool: &SqlitePool, video: &mut Video) {
    if video.thumbnail_path.is_some() {
        return;
    }
    let Some(found) = video.file_path.as_deref().and_then(find_thumbnail) else {
        return;
    };
    let _ = sqlx::query("UPDATE videos SET thumbnail_path = ? WHERE id = ?")
        .bind(&found)
        .bind(&video.id)
        .execute(pool)
        .await;
    video.thumbnail_path = Some(found);
}

/// yt-dlp saves `Title [id].jpg` beside `Title [id].mp4`.
pub fn find_thumbnail(video_path: &str) -> Option<String> {
    let base = Path::new(video_path);
    ["jpg", "jpeg", "webp", "png"]
        .iter()
        .map(|ext| base.with_extension(ext))
        .find(|candidate| candidate.is_file())
        .map(|found| found.to_string_lossy().into_owned())
}

/// The id of the row that already stands for this media, matched by id or by
/// URL. Both are unique; a site can report a new id for a URL we know (or the
/// same id under another URL), and either way it is the same library entry.
pub async fn existing_id(pool: &SqlitePool, id: &str, url: &str) -> AppResult<Option<String>> {
    Ok(
        sqlx::query_scalar("SELECT id FROM videos WHERE id = ? OR url = ? LIMIT 1")
            .bind(id)
            .bind(url)
            .fetch_optional(pool)
            .await?,
    )
}

/// Insert a row that has not been downloaded yet.
pub async fn insert(pool: &SqlitePool, video: &Video) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO videos (id, title, uploader, duration, source, url, playlist_id, \
         folder_id, playlist_index) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&video.id)
    .bind(&video.title)
    .bind(&video.uploader)
    .bind(video.duration)
    .bind(&video.source)
    .bind(&video.url)
    .bind(&video.playlist_id)
    .bind(&video.folder_id)
    .bind(video.playlist_index)
    .execute(pool)
    .await?;
    Ok(())
}

/// Record the file yt-dlp produced, with its size and thumbnail.
pub async fn set_downloaded(pool: &SqlitePool, id: &str, file_path: &str) -> AppResult<()> {
    let size = std::fs::metadata(file_path).ok().map(|meta| meta.len() as i64);
    sqlx::query(
        "UPDATE videos SET file_path = ?, file_size = ?, thumbnail_path = ?, downloaded_at = ? \
         WHERE id = ?",
    )
    .bind(file_path)
    .bind(size)
    .bind(find_thumbnail(file_path))
    .bind(now())
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn update_playback(
    pool: &SqlitePool,
    id: &str,
    position: i64,
    watched: bool,
) -> AppResult<()> {
    sqlx::query("UPDATE videos SET last_position = ?, watched = ? WHERE id = ?")
        .bind(position.max(0))
        .bind(watched)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// File a video into a folder, or unfile it with `None`.
pub async fn move_to_folder(
    pool: &SqlitePool,
    video_id: &str,
    folder_id: Option<&str>,
) -> AppResult<()> {
    if let Some(folder) = folder_id {
        let exists: Option<i64> = sqlx::query_scalar("SELECT 1 FROM folders WHERE id = ?")
            .bind(folder)
            .fetch_optional(pool)
            .await?;
        if exists.is_none() {
            return Err(AppError::user("Folder not found."));
        }
    }
    let result = sqlx::query("UPDATE videos SET folder_id = ? WHERE id = ?")
        .bind(folder_id)
        .bind(video_id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::user("Video not found."));
    }
    Ok(())
}

/// Remove a video from the library. With `delete_file`, its file and
/// thumbnail also go to the Trash (recoverable in Finder, see `disk.rs`).
/// Refuses while a download is running, because deleting the row would leave
/// a yt-dlp process nobody can cancel.
pub async fn remove(pool: &SqlitePool, video_id: &str, delete_file: bool) -> AppResult<()> {
    let video = get(pool, video_id).await?;
    if super::queue::is_running(pool, video_id).await? {
        return Err(AppError::user(
            "Cancel this download in Downloads before removing the video.",
        ));
    }

    // Queue rows go with the video through ON DELETE CASCADE.
    sqlx::query("DELETE FROM videos WHERE id = ?")
        .bind(video_id)
        .execute(pool)
        .await?;

    if delete_file {
        // Try every file even if one fails, so a stuck video does not also
        // leave its thumbnail behind.
        let failures: Vec<String> = [video.file_path, video.thumbnail_path]
            .into_iter()
            .flatten()
            .filter_map(|path| {
                crate::disk::move_to_trash(Path::new(&path))
                    .err()
                    .map(|e| format!("{path}: {e}"))
            })
            .collect();
        if !failures.is_empty() {
            return Err(AppError::user(format!(
                "Removed from the library, but could not move to the Trash: {}",
                failures.join("; ")
            )));
        }
    }
    Ok(())
}

/// [`remove`] for a selection. Videos that cannot go (still downloading,
/// file locked) are skipped and reported together, so one busy video does
/// not block the rest.
pub async fn remove_many(pool: &SqlitePool, ids: &[String], delete_file: bool) -> AppResult<()> {
    let mut problems = Vec::new();
    for id in ids {
        if let Err(e) = remove(pool, id, delete_file).await {
            problems.push(e.to_string());
        }
    }
    match problems.as_slice() {
        [] => Ok(()),
        [only] => Err(AppError::user(only.clone())),
        [first, ..] => Err(AppError::user(format!(
            "{} of {} videos had a problem. First: {first}",
            problems.len(),
            ids.len()
        ))),
    }
}

/// Forget the file of every listed row whose file is gone from disk, so the
/// library offers a fresh download instead of a player that fails silently.
/// Returns the ids that were cleared.
pub async fn clear_missing_files(pool: &SqlitePool, ids: &[String]) -> AppResult<Vec<String>> {
    let mut cleared = Vec::new();
    for chunk in ids.chunks(MAX_BINDS) {
        let sql = format!(
            "SELECT id, file_path FROM videos WHERE file_path IS NOT NULL AND id IN ({})",
            placeholders(chunk.len())
        );
        let mut query = sqlx::query_as::<_, (String, String)>(&sql);
        for id in chunk {
            query = query.bind(id);
        }
        for (id, path) in query.fetch_all(pool).await? {
            if Path::new(&path).is_file() {
                continue;
            }
            // downloaded_at stays: it records that this video was downloaded
            // once, which is what keeps queue cleanup from treating the row
            // as a never-finished download and deleting it (queue.rs).
            sqlx::query(
                "UPDATE videos SET file_path = NULL, file_size = NULL, thumbnail_path = NULL \
                 WHERE id = ?",
            )
            .bind(&id)
            .execute(pool)
            .await?;
            cleared.push(id);
        }
    }
    Ok(cleared)
}

/// Run [`clear_missing_files`] over the whole library. Called at startup,
/// since files can vanish between launches (emptied Trash, moved folder).
pub async fn reconcile_missing_files(pool: &SqlitePool) -> AppResult<usize> {
    let ids: Vec<String> = sqlx::query_scalar("SELECT id FROM videos WHERE file_path IS NOT NULL")
        .fetch_all(pool)
        .await?;
    Ok(clear_missing_files(pool, &ids).await?.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::{count, queue_row, temp_dir, video};
    use crate::db::{folders, test_pool};

    async fn folder_of(pool: &SqlitePool, id: &str) -> Option<String> {
        get(pool, id).await.unwrap().folder_id
    }

    #[tokio::test]
    async fn existing_id_matches_by_id_or_url() {
        let pool = test_pool().await;
        video(&pool, "abc", None).await;
        assert_eq!(existing_id(&pool, "abc", "other").await.unwrap().as_deref(), Some("abc"));
        assert_eq!(
            existing_id(&pool, "new-id", "https://example.com/abc").await.unwrap().as_deref(),
            Some("abc")
        );
        assert_eq!(existing_id(&pool, "x", "y").await.unwrap(), None);
    }

    #[tokio::test]
    async fn set_downloaded_records_size_and_thumbnail() {
        let pool = test_pool().await;
        let dir = temp_dir("downloaded");
        let file = dir.join("a [abc].mp4");
        std::fs::write(&file, b"12345").unwrap();
        std::fs::write(dir.join("a [abc].jpg"), b"x").unwrap();
        video(&pool, "abc", None).await;

        set_downloaded(&pool, "abc", &file.display().to_string()).await.unwrap();
        let row = get(&pool, "abc").await.unwrap();
        assert_eq!(row.file_size, Some(5));
        assert!(row.thumbnail_path.unwrap().ends_with("a [abc].jpg"));
        assert!(row.downloaded_at.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn moving_checks_both_ends() {
        let pool = test_pool().await;
        let folder = folders::create(&pool, "Research").await.unwrap();
        video(&pool, "v1", None).await;

        move_to_folder(&pool, "v1", Some(&folder.id)).await.unwrap();
        assert_eq!(folder_of(&pool, "v1").await.as_deref(), Some(folder.id.as_str()));
        move_to_folder(&pool, "v1", None).await.unwrap();
        assert_eq!(folder_of(&pool, "v1").await, None);

        assert!(move_to_folder(&pool, "v1", Some("nope")).await.is_err());
        assert!(move_to_folder(&pool, "missing", None).await.is_err());
    }

    #[tokio::test]
    async fn removing_keeps_or_deletes_the_file_and_cascades_queue_rows() {
        let pool = test_pool().await;
        let dir = temp_dir("remove");
        let kept = dir.join("kept.mp4");
        // Unique, so the test Trash cannot hold a leftover from another run.
        let trashed_name = format!("{}.mp4", uuid::Uuid::new_v4());
        let deleted = dir.join(&trashed_name);
        std::fs::write(&kept, b"x").unwrap();
        std::fs::write(&deleted, b"x").unwrap();
        video(&pool, "kept", Some(&kept.display().to_string())).await;
        video(&pool, "deleted", Some(&deleted.display().to_string())).await;
        queue_row(&pool, "q-kept", "kept", "done").await;
        queue_row(&pool, "q-deleted", "deleted", "done").await;

        remove(&pool, "kept", false).await.unwrap();
        assert!(kept.exists());
        remove(&pool, "deleted", true).await.unwrap();
        assert!(!deleted.exists());
        // Regression: "Delete file" destroyed the file outright. It now goes
        // to the Trash, where the user can still get it back.
        assert!(crate::disk::in_test_trash(&trashed_name), "moved to the Trash, not destroyed");
        crate::disk::empty_test_trash(&trashed_name);
        assert!(remove(&pool, "kept", false).await.is_err(), "already gone");
        assert_eq!(count(&pool, "queue_items").await, 0, "queue rows cascade");

        video(&pool, "busy", None).await;
        queue_row(&pool, "q-busy", "busy", "downloading").await;
        let blocked = remove(&pool, "busy", false).await.unwrap_err().to_string();
        assert!(blocked.contains("Cancel this download"), "{blocked}");
        assert_eq!(count(&pool, "videos").await, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Regression: one busy video stopped a bulk removal halfway.
    #[tokio::test]
    async fn bulk_removal_skips_busy_videos_and_reports_them() {
        let pool = test_pool().await;
        for id in ["a", "busy", "b"] {
            video(&pool, id, None).await;
        }
        queue_row(&pool, "q", "busy", "downloading").await;
        let ids = ["a", "busy", "b"].map(String::from);
        let error = remove_many(&pool, &ids, false).await.unwrap_err().to_string();
        assert!(error.contains("Cancel this download"), "{error}");
        let left: Vec<String> = sqlx::query_scalar("SELECT id FROM videos").fetch_all(&pool).await.unwrap();
        assert_eq!(left, vec!["busy"]);
    }

    #[tokio::test]
    async fn reconcile_clears_only_rows_whose_file_is_gone() {
        let pool = test_pool().await;
        let dir = temp_dir("reconcile");
        let kept = dir.join("kept.mp4");
        std::fs::write(&kept, b"x").unwrap();
        video(&pool, "kept", Some(&kept.display().to_string())).await;
        video(&pool, "missing", Some(&dir.join("missing.mp4").display().to_string())).await;
        sqlx::query("UPDATE videos SET downloaded_at = 1").execute(&pool).await.unwrap();

        // Scoped: asking about a healthy row leaves the broken one alone.
        assert!(clear_missing_files(&pool, &["kept".into()]).await.unwrap().is_empty());
        assert!(get(&pool, "missing").await.unwrap().file_path.is_some());

        assert_eq!(reconcile_missing_files(&pool).await.unwrap(), 1);
        let missing = get(&pool, "missing").await.unwrap();
        assert!(missing.file_path.is_none() && missing.thumbnail_path.is_none());
        assert!(missing.downloaded_at.is_some(), "still marked as downloaded once");
        let kept_row = get(&pool, "kept").await.unwrap();
        assert!(kept_row.file_path.is_some() && kept_row.thumbnail_path.is_some());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn playback_position_never_goes_negative() {
        let pool = test_pool().await;
        video(&pool, "v1", None).await;
        update_playback(&pool, "v1", -5, true).await.unwrap();
        let row = get(&pool, "v1").await.unwrap();
        assert_eq!((row.last_position, row.watched), (0, true));
    }
}
