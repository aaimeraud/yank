//! The `playlists` table, and how a playlist's videos are filed.

use super::{placeholders, MAX_BINDS};
use crate::db::folders;
use crate::error::AppResult;
use crate::models::Playlist;
use sqlx::SqlitePool;

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Playlist>> {
    Ok(sqlx::query_as(
        "SELECT id, title, source, url, thumbnail_path FROM playlists ORDER BY title",
    )
    .fetch_all(pool)
    .await?)
}

/// Insert the playlist, or refresh the row that already has its URL and
/// return that row's id. Re-adding a playlist must reuse its row; a renamed
/// playlist files new downloads under the name the user sees today.
pub async fn upsert(pool: &SqlitePool, playlist: &Playlist) -> AppResult<String> {
    let existing: Option<String> = sqlx::query_scalar("SELECT id FROM playlists WHERE url = ?")
        .bind(&playlist.url)
        .fetch_optional(pool)
        .await?;
    if let Some(id) = existing {
        sqlx::query(
            "UPDATE playlists SET title = ?, source = ?, \
             thumbnail_path = COALESCE(?, thumbnail_path) WHERE id = ?",
        )
        .bind(&playlist.title)
        .bind(&playlist.source)
        .bind(&playlist.thumbnail_path)
        .bind(&id)
        .execute(pool)
        .await?;
        return Ok(id);
    }
    sqlx::query(
        "INSERT INTO playlists (id, title, source, url, thumbnail_path) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&playlist.id)
    .bind(&playlist.title)
    .bind(&playlist.source)
    .bind(&playlist.url)
    .bind(&playlist.thumbnail_path)
    .execute(pool)
    .await?;
    Ok(playlist.id.clone())
}

/// The library folder a playlist's videos go into: its title, trimmed to a
/// valid folder name.
pub fn folder_name(title: &str) -> String {
    let trimmed = title.trim();
    let source = if trimmed.is_empty() { "Playlist" } else { trimmed };
    source
        .chars()
        .take(folders::MAX_NAME_CHARS)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Bring the videos that already exist in the library in line with the
/// playlist, given its entry ids in playlist order:
///
/// - videos without a folder join the playlist's folder (videos the user
///   filed elsewhere stay where they are);
/// - a video downloaded on its own before the playlist existed gets linked;
/// - every entry gets its current 1-based position, so a reordered playlist
///   renumbers on the next add.
pub async fn file_existing_entries(
    pool: &SqlitePool,
    playlist_id: &str,
    folder_id: &str,
    entry_ids: &[String],
) -> AppResult<()> {
    sqlx::query("UPDATE videos SET folder_id = ? WHERE playlist_id = ? AND folder_id IS NULL")
        .bind(folder_id)
        .bind(playlist_id)
        .execute(pool)
        .await?;

    for chunk in entry_ids.chunks(MAX_BINDS) {
        let sql = format!(
            "UPDATE videos SET folder_id = ?, playlist_id = COALESCE(playlist_id, ?) \
             WHERE id IN ({}) AND folder_id IS NULL",
            placeholders(chunk.len())
        );
        let mut query = sqlx::query(&sql).bind(folder_id).bind(playlist_id);
        for id in chunk {
            query = query.bind(id);
        }
        query.execute(pool).await?;
    }

    for (position, id) in entry_ids.iter().enumerate() {
        sqlx::query("UPDATE videos SET playlist_index = ? WHERE id = ? AND playlist_id = ?")
            .bind(position as i64 + 1)
            .bind(id)
            .bind(playlist_id)
            .execute(pool)
            .await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::{count, video};
    use crate::db::{test_pool, videos};
    use crate::models::Video;

    fn playlist(id: &str, url: &str) -> Playlist {
        Playlist {
            id: id.to_string(),
            title: "List".to_string(),
            source: "youtube".to_string(),
            url: url.to_string(),
            thumbnail_path: None,
        }
    }

    async fn link(pool: &SqlitePool, video_id: &str, playlist_id: &str) {
        sqlx::query("UPDATE videos SET playlist_id = ? WHERE id = ?")
            .bind(playlist_id)
            .bind(video_id)
            .execute(pool)
            .await
            .unwrap();
    }

    async fn positions(pool: &SqlitePool, ids: &[&str]) -> Vec<Option<i64>> {
        let mut out = Vec::new();
        for id in ids {
            out.push(videos::get(pool, id).await.unwrap().playlist_index);
        }
        out
    }

    #[tokio::test]
    async fn upsert_reuses_the_row_and_refreshes_metadata() {
        let pool = test_pool().await;
        assert_eq!(upsert(&pool, &playlist("p1", "u")).await.unwrap(), "p1");
        let mut renamed = playlist("p2", "u");
        renamed.title = "Renamed".to_string();
        assert_eq!(upsert(&pool, &renamed).await.unwrap(), "p1");
        assert_eq!(count(&pool, "playlists").await, 1);
        assert_eq!(list(&pool).await.unwrap()[0].title, "Renamed");
    }

    #[test]
    fn folder_names_are_trimmed_capped_and_defaulted() {
        assert_eq!(folder_name("  My Playlist  "), "My Playlist");
        assert_eq!(folder_name(&"x".repeat(80)).chars().count(), 60);
        assert_eq!(folder_name("   "), "Playlist");
    }

    #[tokio::test]
    async fn filing_adopts_standalone_videos_but_respects_manual_folders() {
        let pool = test_pool().await;
        upsert(&pool, &playlist("p1", "u")).await.unwrap();
        let playlist_folder = folders::find_or_create(&pool, "List").await.unwrap();
        let keepers = folders::create(&pool, "Keepers").await.unwrap();
        // "linked" belongs to the playlist, "standalone" was downloaded on its
        // own first, "filed" was put in a user folder that must be respected.
        for id in ["linked", "standalone", "filed"] {
            video(&pool, id, None).await;
        }
        link(&pool, "linked", "p1").await;
        videos::move_to_folder(&pool, "filed", Some(&keepers.id)).await.unwrap();

        let entries = ["linked", "standalone", "filed"].map(String::from);
        file_existing_entries(&pool, "p1", &playlist_folder, &entries).await.unwrap();

        let folder_of = |video: Video| video.folder_id;
        let linked = videos::get(&pool, "linked").await.unwrap();
        assert_eq!(folder_of(linked).as_deref(), Some(playlist_folder.as_str()));
        let standalone = videos::get(&pool, "standalone").await.unwrap();
        assert_eq!(standalone.folder_id.as_deref(), Some(playlist_folder.as_str()));
        assert_eq!(standalone.playlist_id.as_deref(), Some("p1"));
        let filed = videos::get(&pool, "filed").await.unwrap();
        assert_eq!(folder_of(filed).as_deref(), Some(keepers.id.as_str()));
    }

    #[tokio::test]
    async fn positions_follow_entry_order_and_renumber_on_re_add() {
        let pool = test_pool().await;
        upsert(&pool, &playlist("p1", "u1")).await.unwrap();
        upsert(&pool, &playlist("p2", "u2")).await.unwrap();
        let folder = folders::find_or_create(&pool, "List").await.unwrap();
        for id in ["a", "b", "c", "other"] {
            video(&pool, id, None).await;
        }
        for id in ["a", "b", "c"] {
            link(&pool, id, "p1").await;
        }
        link(&pool, "other", "p2").await;
        sqlx::query("UPDATE videos SET playlist_index = 9 WHERE id = 'other'")
            .execute(&pool)
            .await
            .unwrap();

        file_existing_entries(&pool, "p1", &folder, &["a", "b", "c"].map(String::from)).await.unwrap();
        assert_eq!(positions(&pool, &["a", "b", "c"]).await, vec![Some(1), Some(2), Some(3)]);
        assert_eq!(positions(&pool, &["other"]).await, vec![Some(9)], "another playlist keeps its numbers");

        file_existing_entries(&pool, "p1", &folder, &["c", "a", "b"].map(String::from)).await.unwrap();
        assert_eq!(positions(&pool, &["c", "a", "b"]).await, vec![Some(1), Some(2), Some(3)]);
    }
}
