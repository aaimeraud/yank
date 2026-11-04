//! SQLite access. One file per table; each function takes the pool and does
//! one thing, so commands and the download worker can share them and tests
//! can call them against an in-memory database.
//!
//! Foreign keys are ON (sqlx's default for SQLite), so deleting a video
//! cascades to its queue rows and deleting a folder or playlist unlinks its
//! videos. See `migrations/` for the schema.

pub mod folders;
pub mod playlists;
pub mod queue;
pub mod videos;

use crate::error::AppResult;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
use std::path::Path;

/// SQLite refuses statements with more than 999 bound variables on older
/// builds. Lists that come from the user (a playlist, a selection) are bound
/// in chunks of this size.
pub const MAX_BINDS: usize = 400;

pub async fn open(path: &Path) -> AppResult<SqlitePool> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;
    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .map_err(sqlx::Error::from)?;
    Ok(pool)
}

/// `?, ?, ?` for an `IN (...)` clause of `count` values.
pub fn placeholders(count: usize) -> String {
    vec!["?"; count].join(",")
}

pub fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

/// A fresh, migrated in-memory database. One connection, because every new
/// connection to `sqlite::memory:` would open a different empty database.
#[cfg(test)]
pub async fn test_pool() -> SqlitePool {
    let options = SqliteConnectOptions::new()
        .in_memory(true)
        .foreign_keys(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    sqlx::migrate!("./migrations").run(&pool).await.unwrap();
    pool
}

/// Test fixtures shared by every table's tests.
#[cfg(test)]
pub mod fixtures {
    use super::*;

    /// Insert a library row with only the columns tests usually care about.
    pub async fn video(pool: &SqlitePool, id: &str, file_path: Option<&str>) {
        sqlx::query(
            "INSERT INTO videos (id, title, source, url, file_path, thumbnail_path) \
             VALUES (?, ?, 'youtube', ?, ?, ?)",
        )
        .bind(id)
        .bind(format!("Video {id}"))
        .bind(format!("https://example.com/{id}"))
        .bind(file_path)
        .bind(file_path.map(|path| path.replace(".mp4", ".jpg")))
        .execute(pool)
        .await
        .unwrap();
    }

    pub async fn queue_row(pool: &SqlitePool, id: &str, video_id: &str, status: &str) {
        sqlx::query(
            "INSERT INTO queue_items (id, video_id, status, created_at) VALUES (?, ?, ?, 0)",
        )
        .bind(id)
        .bind(video_id)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }

    pub async fn count(pool: &SqlitePool, table: &str) -> i64 {
        sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .unwrap()
    }

    /// A unique scratch directory under the system temp dir.
    pub fn temp_dir(label: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("yank-{label}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }
}
