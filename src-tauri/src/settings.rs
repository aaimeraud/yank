//! User preferences, stored as key/value rows in the `settings` table.
//!
//! Every read goes through [`Settings::load`], which fills in defaults, so no
//! caller ever has to handle a missing download folder or a junk concurrency
//! value.

use crate::error::{AppError, AppResult};
use crate::models::Format;
use serde::Serialize;
use sqlx::SqlitePool;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Keys as stored in the database. `default_quality` predates the `Format`
/// name and is kept so existing installs keep their choice.
pub const KEY_DOWNLOAD_DIR: &str = "download_dir";
pub const KEY_FORMAT: &str = "default_quality";
pub const KEY_CONCURRENCY: &str = "concurrency";
pub const KEY_COOKIES: &str = "cookies_path";

pub const DEFAULT_CONCURRENCY: usize = 2;
pub const MAX_CONCURRENCY: usize = 4;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Settings {
    pub download_dir: String,
    pub default_format: Format,
    pub concurrency: usize,
    /// Netscape cookies.txt passed to yt-dlp for private or age-gated media.
    pub cookies_path: Option<String>,
}

impl Settings {
    /// `fallback_dir` is used when the user never picked a folder
    /// (`~/Movies/Yank` in the app, a temp dir in tests).
    ///
    /// Runs on every enqueue and worker start, so it is one query. An empty
    /// value counts as unset, which is how the UI clears the cookies file.
    pub async fn load(pool: &SqlitePool, fallback_dir: &Path) -> Self {
        let mut rows: HashMap<String, String> =
            sqlx::query_as::<_, (String, String)>("SELECT key, value FROM settings WHERE value != ''")
                .fetch_all(pool)
                .await
                .map(|rows| rows.into_iter().collect())
                .unwrap_or_default();
        Self {
            download_dir: rows
                .remove(KEY_DOWNLOAD_DIR)
                .unwrap_or_else(|| fallback_dir.display().to_string()),
            default_format: Format::parse(rows.get(KEY_FORMAT).map(String::as_str)),
            concurrency: clamp_concurrency(rows.get(KEY_CONCURRENCY).map(String::as_str)),
            cookies_path: rows.remove(KEY_COOKIES),
        }
    }
}

/// Validate and store one value. Unknown keys are rejected so a frontend typo
/// fails loudly instead of writing a row nothing reads.
pub async fn set(pool: &SqlitePool, key: &str, value: &str) -> AppResult<()> {
    let value = normalize(key, value)?;
    sqlx::query(
        "INSERT INTO settings (key, value) VALUES (?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

fn normalize(key: &str, value: &str) -> AppResult<String> {
    match key {
        KEY_DOWNLOAD_DIR => {
            if !Path::new(value).is_dir() {
                return Err(AppError::user(format!("{value} is not a folder.")));
            }
            Ok(value.to_string())
        }
        KEY_FORMAT => Ok(Format::parse(Some(value)).as_str().to_string()),
        KEY_CONCURRENCY => Ok(clamp_concurrency(Some(value)).to_string()),
        KEY_COOKIES => {
            if !value.is_empty() && !Path::new(value).is_file() {
                return Err(AppError::user(format!("{value} is not a file.")));
            }
            Ok(value.to_string())
        }
        other => Err(AppError::user(format!("Unknown setting \"{other}\"."))),
    }
}

/// Keep concurrency in a range that cannot starve the machine or the site.
pub fn clamp_concurrency(raw: Option<&str>) -> usize {
    raw.and_then(|value| value.parse::<usize>().ok())
        .unwrap_or(DEFAULT_CONCURRENCY)
        .clamp(1, MAX_CONCURRENCY)
}

/// `~/Movies/Yank`, created on first use so the first download just works.
pub fn default_download_dir(movies_dir: Option<PathBuf>) -> PathBuf {
    let base = movies_dir
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join("Movies")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("Yank")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_pool;

    #[tokio::test]
    async fn defaults_fill_every_gap() {
        let pool = test_pool().await;
        let settings = Settings::load(&pool, Path::new("/fallback")).await;
        assert_eq!(
            settings,
            Settings {
                download_dir: "/fallback".to_string(),
                default_format: Format::Video,
                concurrency: 2,
                cookies_path: None,
            }
        );
    }

    #[tokio::test]
    async fn stored_values_win_and_empty_means_unset() {
        let pool = test_pool().await;
        let dir = std::env::temp_dir();
        set(&pool, KEY_DOWNLOAD_DIR, &dir.display().to_string()).await.unwrap();
        set(&pool, KEY_FORMAT, "audio").await.unwrap();
        set(&pool, KEY_CONCURRENCY, "9").await.unwrap();
        set(&pool, KEY_COOKIES, "").await.unwrap();

        let settings = Settings::load(&pool, Path::new("/fallback")).await;
        assert_eq!(settings.download_dir, dir.display().to_string());
        assert_eq!(settings.default_format, Format::Audio);
        assert_eq!(settings.concurrency, MAX_CONCURRENCY);
        assert_eq!(settings.cookies_path, None);
    }

    #[tokio::test]
    async fn rejects_bad_values_and_unknown_keys() {
        let pool = test_pool().await;
        assert!(set(&pool, KEY_DOWNLOAD_DIR, "/definitely/not/here").await.is_err());
        assert!(set(&pool, KEY_COOKIES, "/definitely/not/here.txt").await.is_err());
        assert!(set(&pool, "theme", "dark").await.is_err());
        // An unknown format is coerced to the default rather than stored as-is.
        set(&pool, KEY_FORMAT, "8k-hdr").await.unwrap();
        let stored: String = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
            .bind(KEY_FORMAT)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(stored, "video");
    }

    #[test]
    fn concurrency_is_clamped() {
        assert_eq!(clamp_concurrency(None), 2);
        assert_eq!(clamp_concurrency(Some("3")), 3);
        assert_eq!(clamp_concurrency(Some("0")), 1);
        assert_eq!(clamp_concurrency(Some("9")), 4);
        assert_eq!(clamp_concurrency(Some("junk")), 2);
    }

    #[test]
    fn default_folder_lives_under_movies() {
        assert_eq!(
            default_download_dir(Some(PathBuf::from("/Users/me/Movies"))),
            PathBuf::from("/Users/me/Movies/Yank")
        );
    }
}
