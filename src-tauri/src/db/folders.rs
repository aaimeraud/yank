//! The `folders` table. A folder is a user-made group of videos; a playlist
//! download creates one named after the playlist. Downloads of a filed video
//! land in a directory with the same name (see [`disk_name`]).

use super::now;
use crate::error::{AppError, AppResult};
use crate::models::Folder;
use sqlx::SqlitePool;

pub const MAX_NAME_CHARS: usize = 60;

pub async fn list(pool: &SqlitePool) -> AppResult<Vec<Folder>> {
    Ok(sqlx::query_as(
        "SELECT f.id, f.name, f.created_at, COUNT(v.id) AS video_count \
         FROM folders f LEFT JOIN videos v ON v.folder_id = f.id \
         GROUP BY f.id ORDER BY f.name COLLATE NOCASE",
    )
    .fetch_all(pool)
    .await?)
}

pub async fn create(pool: &SqlitePool, raw_name: &str) -> AppResult<Folder> {
    let name = validate_name(raw_name)?;
    let folder = Folder {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        created_at: now(),
        video_count: 0,
    };
    sqlx::query("INSERT INTO folders (id, name, created_at) VALUES (?, ?, ?)")
        .bind(&folder.id)
        .bind(&folder.name)
        .bind(folder.created_at)
        .execute(pool)
        .await
        .map_err(|e| duplicate_name(e.into(), &folder.name))?;
    Ok(folder)
}

pub async fn rename(pool: &SqlitePool, id: &str, raw_name: &str) -> AppResult<()> {
    let name = validate_name(raw_name)?;
    let result = sqlx::query("UPDATE folders SET name = ? WHERE id = ?")
        .bind(&name)
        .bind(id)
        .execute(pool)
        .await
        .map_err(|e| duplicate_name(e.into(), &name))?;
    if result.rows_affected() == 0 {
        return Err(AppError::user("Folder not found."));
    }
    Ok(())
}

/// Delete a folder. Its videos stay in the library, unfiled
/// (`ON DELETE SET NULL` on `videos.folder_id`).
pub async fn delete(pool: &SqlitePool, id: &str) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM folders WHERE id = ?")
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::user("Folder not found."));
    }
    Ok(())
}

/// The folder with this name (case-insensitive), created if needed. Used for
/// playlists, where re-adding the same playlist must reuse its folder.
pub async fn find_or_create(pool: &SqlitePool, name: &str) -> AppResult<String> {
    let find = || {
        sqlx::query_scalar::<_, String>("SELECT id FROM folders WHERE name = ? COLLATE NOCASE")
            .bind(name)
            .fetch_optional(pool)
    };
    if let Some(id) = find().await? {
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    let inserted = sqlx::query("INSERT INTO folders (id, name, created_at) VALUES (?, ?, ?)")
        .bind(&id)
        .bind(name)
        .bind(now())
        .execute(pool)
        .await
        .map_err(AppError::from);
    match inserted {
        Ok(_) => Ok(id),
        // Lost a race with another insert of the same name: use theirs.
        Err(e) if e.is_unique_violation() => find()
            .await?
            .ok_or_else(|| AppError::user("Folder not found.")),
        Err(e) => Err(e),
    }
}

/// The on-disk directory name for a video's folder, or None when unfiled.
pub async fn disk_name_for_video(pool: &SqlitePool, video_id: &str) -> Option<String> {
    let name: Option<String> = sqlx::query_scalar(
        "SELECT f.name FROM videos v JOIN folders f ON f.id = v.folder_id WHERE v.id = ?",
    )
    .bind(video_id)
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();
    name.map(|raw| disk_name(&raw)).filter(|clean| !clean.is_empty())
}

/// Folder names come from the user (or a playlist title). A slash would add a
/// directory level and a leading dot would hide the download in Finder.
pub fn disk_name(name: &str) -> String {
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

/// Trim, refuse empty, cap the length.
pub fn validate_name(raw: &str) -> AppResult<String> {
    let name = raw.trim();
    if name.is_empty() {
        return Err(AppError::user("Folder name cannot be empty."));
    }
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(AppError::user(format!(
            "Folder name is limited to {MAX_NAME_CHARS} characters."
        )));
    }
    Ok(name.to_string())
}

fn duplicate_name(error: AppError, name: &str) -> AppError {
    if error.is_unique_violation() {
        AppError::user(format!("A folder named \"{name}\" already exists."))
    } else {
        error
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::{count, video};
    use crate::db::{test_pool, videos};

    #[tokio::test]
    async fn names_are_trimmed_and_unique_ignoring_case() {
        let pool = test_pool().await;
        assert!(create(&pool, "   ").await.is_err());
        let folder = create(&pool, "  Watch later  ").await.unwrap();
        assert_eq!(folder.name, "Watch later");

        let duplicate = create(&pool, "watch LATER").await.unwrap_err().to_string();
        assert!(duplicate.contains("already exists"), "{duplicate}");
        assert!(create(&pool, &"x".repeat(61)).await.is_err());
        assert_eq!(list(&pool).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn renaming_keeps_names_unique() {
        let pool = test_pool().await;
        let music = create(&pool, "Music").await.unwrap();
        let talks = create(&pool, "Talks").await.unwrap();

        let clash = rename(&pool, &talks.id, " music ").await.unwrap_err().to_string();
        assert!(clash.contains("already exists"), "{clash}");
        rename(&pool, &talks.id, "  Long talks ").await.unwrap();
        let names: Vec<_> = list(&pool).await.unwrap().into_iter().map(|f| f.name).collect();
        assert_eq!(names, vec!["Long talks", "Music"]);
        assert!(rename(&pool, &music.id, "").await.is_err());
        assert!(rename(&pool, "missing", "Any").await.is_err());
    }

    #[tokio::test]
    async fn deleting_unfiles_videos_and_keeps_them() {
        let pool = test_pool().await;
        let folder = create(&pool, "Keepers").await.unwrap();
        video(&pool, "v1", None).await;
        videos::move_to_folder(&pool, "v1", Some(&folder.id)).await.unwrap();
        assert_eq!(list(&pool).await.unwrap()[0].video_count, 1);

        delete(&pool, &folder.id).await.unwrap();
        assert!(list(&pool).await.unwrap().is_empty());
        assert_eq!(videos::get(&pool, "v1").await.unwrap().folder_id, None);
        assert_eq!(count(&pool, "videos").await, 1);
        assert!(delete(&pool, &folder.id).await.is_err());
    }

    #[tokio::test]
    async fn find_or_create_reuses_by_name() {
        let pool = test_pool().await;
        let first = find_or_create(&pool, "Talks").await.unwrap();
        assert_eq!(find_or_create(&pool, "talks").await.unwrap(), first);
        assert_eq!(count(&pool, "folders").await, 1);
    }

    #[tokio::test]
    async fn disk_name_follows_the_videos_folder() {
        let pool = test_pool().await;
        let folder = create(&pool, "Systems/Design 3.0").await.unwrap();
        video(&pool, "filed", None).await;
        video(&pool, "loose", None).await;
        videos::move_to_folder(&pool, "filed", Some(&folder.id)).await.unwrap();

        assert_eq!(
            disk_name_for_video(&pool, "filed").await.as_deref(),
            Some("Systems-Design 3.0")
        );
        assert_eq!(disk_name_for_video(&pool, "loose").await, None);
        assert_eq!(disk_name_for_video(&pool, "missing").await, None);
    }

    #[test]
    fn disk_names_cannot_escape_or_hide() {
        assert_eq!(disk_name("Systems Design 3.0"), "Systems Design 3.0");
        assert_eq!(disk_name("a/b:c\\d"), "a-b-c-d");
        assert_eq!(disk_name("  .hidden.  "), "hidden");
        assert_eq!(disk_name("   "), "");
        assert_eq!(disk_name(&"x".repeat(120)).len(), 80);
    }
}
