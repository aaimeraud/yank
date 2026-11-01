use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use sqlx::migrate::MigrateDatabase;
use sqlx::Sqlite;
use std::path::PathBuf;
use tauri::Manager;

pub struct DbState {
    pub pool: SqlitePool,
}

pub fn db_path(app: &tauri::AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("yank.db")
}

pub async fn init_db(app: &tauri::AppHandle) -> SqlitePool {
    let path = db_path(app);
    let url = format!("sqlite:{}", path.display());
    if !Sqlite::database_exists(&url).await.unwrap_or(false) {
        Sqlite::create_database(&url).await.expect("create db");
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .expect("connect db");
    sqlx::migrate!("./migrations").run(&pool).await.expect("migrate");
    pool
}

/// A file can vanish between launches: cleaned temp folders, a moved download
/// directory, the user emptying the Trash. Rows that still claim a missing file
/// would open a player that fails silently, so clear the claim and let the
/// library offer a fresh download.
pub async fn reconcile_missing_files(pool: &SqlitePool) -> Result<usize, String> {
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT id, file_path FROM videos WHERE file_path IS NOT NULL")
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

    let mut cleared = 0;
    for (id, path) in rows {
        if std::path::Path::new(&path).exists() {
            continue;
        }
        sqlx::query(
            "UPDATE videos SET file_path=NULL, file_size=NULL, thumbnail_path=NULL, downloaded_at=NULL WHERE id=?",
        )
        .bind(&id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
        cleared += 1;
    }
    Ok(cleared)
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
            "INSERT INTO videos (id, title, source, url, file_path, thumbnail_path, last_position, watched) VALUES (?,?,?,?,?,?,0,0)",
        )
        .bind(id)
        .bind("Test video")
        .bind("Youtube")
        .bind(format!("https://example.com/{id}"))
        .bind(file_path)
        .bind(file_path.map(|p| p.replace(".mp4", ".jpg")))
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn clears_rows_whose_file_is_gone() {
        let pool = test_pool().await;
        let dir = std::env::temp_dir().join(format!("yank-reconcile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let kept = dir.join("kept.mp4");
        std::fs::write(&kept, b"x").unwrap();
        let kept = kept.to_string_lossy().to_string();
        let missing = dir.join("missing.mp4").to_string_lossy().to_string();

        insert_video(&pool, "kept", Some(&kept)).await;
        insert_video(&pool, "missing", Some(&missing)).await;

        assert_eq!(reconcile_missing_files(&pool).await.unwrap(), 1);

        let (path, thumb): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT file_path, thumbnail_path FROM videos WHERE id='kept'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(path.as_deref(), Some(kept.as_str()));
        assert!(thumb.is_some());

        let (path, thumb): (Option<String>, Option<String>) =
            sqlx::query_as("SELECT file_path, thumbnail_path FROM videos WHERE id='missing'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert!(path.is_none());
        assert!(thumb.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
