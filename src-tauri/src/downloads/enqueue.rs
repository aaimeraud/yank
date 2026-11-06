//! Turning a pasted URL into library rows and queued downloads.
//!
//! `plan` does all the database work and returns the jobs to start; it never
//! runs yt-dlp, so it is tested against an in-memory database with
//! hand-written `UrlInfo` values.

use crate::db::{folders, playlists, queue, queue::Job, videos};
use crate::error::{AppError, AppResult};
use crate::models::{Format, Metadata, Playlist, UrlInfo, Video};
use sqlx::SqlitePool;

#[derive(Debug, Default)]
pub struct Plan {
    pub jobs: Vec<Job>,
    /// Entries already downloaded, already queued, without a usable URL,
    /// or live (see [`is_recording`]).
    pub skipped: usize,
}

/// Record everything `info` describes and create a queue row for each entry
/// that needs downloading. `url` is what the user pasted.
pub async fn plan(pool: &SqlitePool, info: &UrlInfo, url: &str, format: Format) -> AppResult<Plan> {
    if info.entries.is_empty() {
        return Err(AppError::user(if info.is_playlist {
            "This playlist is empty or private."
        } else {
            "yt-dlp found nothing to download at this URL."
        }));
    }
    let context = if info.is_playlist {
        Some(file_playlist(pool, info, url).await?)
    } else {
        None
    };

    let mut plan = Plan::default();
    for meta in &info.entries {
        // A playlist entry needs its own URL: the playlist URL would make
        // yt-dlp fetch the whole list again for every entry.
        let target = meta
            .webpage_url
            .clone()
            .or_else(|| (!info.is_playlist).then(|| url.to_string()));
        let Some(target) = target else {
            plan.skipped += 1;
            continue;
        };
        if info.is_playlist && is_recording(meta) {
            plan.skipped += 1;
            continue;
        }
        match video_to_download(pool, meta, &target, context.as_ref()).await? {
            Some(video_id) => plan.jobs.push(queue::insert(pool, &video_id, &target, format).await?),
            None => plan.skipped += 1,
        }
    }
    Ok(plan)
}

/// A live entry would record until the stream ends (never, for a 24/7
/// radio) and an upcoming one has nothing to fetch, so a playlist download
/// leaves both out. A live link pasted on its own is still downloaded:
/// recording one on purpose is a choice, catching one inside a playlist
/// is not.
fn is_recording(meta: &Metadata) -> bool {
    matches!(meta.live_status.as_deref(), Some("is_live" | "is_upcoming"))
}

/// For a hit of the YouTube screen: a single live or upcoming video is
/// refused, whatever the search listing said (its `live_status` can be
/// missing there; the full lookup's is not).
pub fn refuse_recording(info: &UrlInfo) -> AppResult<()> {
    match info.entries.as_slice() {
        [only] if !info.is_playlist && is_recording(only) => Err(AppError::user(
            if only.live_status.as_deref() == Some("is_live") {
                "Live streams can be watched, not downloaded."
            } else {
                "This premiere has not started yet."
            },
        )),
        _ => Ok(()),
    }
}

/// The playlist row and folder every entry is filed under.
struct PlaylistContext {
    playlist_id: String,
    folder_id: String,
}

async fn file_playlist(pool: &SqlitePool, info: &UrlInfo, url: &str) -> AppResult<PlaylistContext> {
    let first = info.entries.first();
    let playlist_id = playlists::upsert(
        pool,
        &Playlist {
            id: uuid::Uuid::new_v4().to_string(),
            title: info.title.clone(),
            source: first.and_then(|m| m.extractor.clone()).unwrap_or_else(|| "generic".into()),
            url: url.to_string(),
            thumbnail_path: first.and_then(|m| m.thumbnail.clone()),
        },
    )
    .await?;
    let folder_id = folders::find_or_create(pool, &playlists::folder_name(&info.title)).await?;
    let ids: Vec<String> = info.entries.iter().map(|m| m.id.clone()).filter(|id| !id.is_empty()).collect();
    playlists::file_existing_entries(pool, &playlist_id, &folder_id, &ids).await?;
    Ok(PlaylistContext { playlist_id, folder_id })
}

/// The library id to download for this entry, inserting a row if it is new.
/// None when there is nothing to do: the file is already on disk, or a
/// download for it is already queued, running or paused.
async fn video_to_download(
    pool: &SqlitePool,
    meta: &Metadata,
    url: &str,
    context: Option<&PlaylistContext>,
) -> AppResult<Option<String>> {
    let id = if meta.id.is_empty() { uuid::Uuid::new_v4().to_string() } else { meta.id.clone() };
    if let Some(existing) = videos::existing_id(pool, &id, url).await? {
        let video = videos::get(pool, &existing).await?;
        let busy = video.file_path.is_some() || queue::has_active(pool, &existing).await?;
        return Ok((!busy).then_some(existing));
    }
    videos::insert(pool, &new_video(id.clone(), meta, url, context)).await?;
    Ok(Some(id))
}

fn new_video(id: String, meta: &Metadata, url: &str, context: Option<&PlaylistContext>) -> Video {
    Video {
        id,
        title: meta.title.clone(),
        uploader: meta.uploader.clone(),
        duration: meta.duration,
        thumbnail_path: None,
        source: meta.extractor.clone().unwrap_or_else(|| "generic".into()),
        url: url.to_string(),
        file_path: None,
        file_size: None,
        downloaded_at: None,
        last_position: 0,
        watched: false,
        playlist_id: context.map(|c| c.playlist_id.clone()),
        folder_id: context.map(|c| c.folder_id.clone()),
        playlist_index: context.map(|_| meta.index),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::{count, queue_row, video};
    use crate::db::test_pool;

    fn meta(id: &str, index: i64) -> Metadata {
        Metadata {
            live_status: None,
            id: id.into(),
            title: format!("Video {id}"),
            uploader: Some("Uploader".into()),
            duration: Some(60),
            thumbnail: None,
            extractor: Some("youtube".into()),
            webpage_url: Some(format!("https://www.youtube.com/watch?v={id}")),
            index,
        }
    }

    fn playlist(entries: Vec<Metadata>) -> UrlInfo {
        UrlInfo { title: "Sample Folder".into(), is_playlist: true, entries }
    }

    const LIST_URL: &str = "https://www.youtube.com/playlist?list=PL1";

    #[tokio::test]
    async fn a_playlist_queues_every_entry_in_its_folder_and_order() {
        let pool = test_pool().await;
        let info = playlist(vec![meta("a", 1), meta("b", 2), meta("c", 3)]);
        let plan = plan(&pool, &info, LIST_URL, Format::Video).await.unwrap();

        assert_eq!(plan.jobs.len(), 3);
        assert_eq!(plan.jobs[1].url, "https://www.youtube.com/watch?v=b");
        let folder = folders::list(&pool).await.unwrap();
        assert_eq!((folder[0].name.as_str(), folder[0].video_count), ("Sample Folder", 3));
        let b = videos::get(&pool, "b").await.unwrap();
        assert_eq!(b.playlist_index, Some(2));
        assert!(b.playlist_id.is_some());
    }

    #[tokio::test]
    async fn re_adding_skips_downloaded_and_in_flight_entries() {
        let pool = test_pool().await;
        video(&pool, "done", Some("/tmp/done.mp4")).await;
        video(&pool, "busy", None).await;
        queue_row(&pool, "q-busy", "busy", "paused").await;
        video(&pool, "failed", None).await;
        queue_row(&pool, "q-failed", "failed", "failed").await;

        let info = playlist(vec![meta("done", 1), meta("busy", 2), meta("failed", 3), meta("new", 4)]);
        let plan = plan(&pool, &info, LIST_URL, Format::Video).await.unwrap();
        let ids: Vec<_> = plan.jobs.iter().map(|job| job.video_id.as_str()).collect();
        assert_eq!(ids, vec!["failed", "new"]);
        assert_eq!(plan.skipped, 2);
    }

    /// Regression: Download all on a playlist holding a 24/7 live radio
    /// queued a download that never ends.
    #[tokio::test]
    async fn a_playlist_leaves_out_live_and_upcoming_entries() {
        let pool = test_pool().await;
        let live = Metadata { live_status: Some("is_live".into()), ..meta("radio", 2) };
        let premiere = Metadata { live_status: Some("is_upcoming".into()), ..meta("soon", 3) };
        let was_live = Metadata { live_status: Some("was_live".into()), ..meta("vod", 4) };
        let info = playlist(vec![meta("a", 1), live, premiere, was_live]);
        let plan = plan(&pool, &info, LIST_URL, Format::Video).await.unwrap();
        let queued: Vec<&str> = plan.jobs.iter().map(|job| job.url.as_str()).collect();
        assert_eq!(queued, ["https://www.youtube.com/watch?v=a", "https://www.youtube.com/watch?v=vod"]);
        assert_eq!(plan.skipped, 2);
    }

    #[test]
    fn a_live_hit_from_the_search_screen_is_refused() {
        let single = |status: Option<&str>| UrlInfo {
            title: "T".into(),
            is_playlist: false,
            entries: vec![Metadata { live_status: status.map(String::from), ..meta("v", 1) }],
        };
        assert!(refuse_recording(&single(Some("is_live"))).unwrap_err().to_string().contains("Live"));
        assert!(refuse_recording(&single(Some("is_upcoming"))).is_err());
        assert!(refuse_recording(&single(Some("was_live"))).is_ok());
        assert!(refuse_recording(&single(None)).is_ok());
        // A playlist is filtered entry by entry instead (see above).
        let live = Metadata { live_status: Some("is_live".into()), ..meta("radio", 1) };
        assert!(refuse_recording(&playlist(vec![live])).is_ok());
    }

    #[tokio::test]
    async fn a_live_link_pasted_alone_is_still_downloaded() {
        let pool = test_pool().await;
        let live = Metadata { live_status: Some("is_live".into()), ..meta("radio", 1) };
        let info = UrlInfo { title: "Radio".into(), is_playlist: false, entries: vec![live] };
        assert_eq!(plan(&pool, &info, "https://www.youtube.com/watch?v=radio", Format::Video).await.unwrap().jobs.len(), 1);
    }

    #[tokio::test]
    async fn a_single_video_is_not_filed_or_numbered() {
        let pool = test_pool().await;
        let info = UrlInfo { title: "Solo".into(), is_playlist: false, entries: vec![meta("solo", 1)] };
        let plan = plan(&pool, &info, "https://youtu.be/solo", Format::Audio).await.unwrap();
        assert_eq!(plan.jobs[0].format, Format::Audio);
        let solo = videos::get(&pool, "solo").await.unwrap();
        assert_eq!((solo.folder_id, solo.playlist_id, solo.playlist_index), (None, None, None));
        assert_eq!(count(&pool, "playlists").await, 0);
    }

    #[tokio::test]
    async fn a_single_video_without_page_url_uses_the_pasted_url() {
        let pool = test_pool().await;
        let mut bare = meta("t1", 1);
        bare.webpage_url = None;
        bare.extractor = Some("twitter".into());
        let info = UrlInfo { title: "Tweet".into(), is_playlist: false, entries: vec![bare] };
        let plan = plan(&pool, &info, "https://x.com/a/status/1", Format::Video).await.unwrap();
        assert_eq!(plan.jobs[0].url, "https://x.com/a/status/1");
    }

    #[tokio::test]
    async fn the_same_url_under_a_new_id_reuses_the_row() {
        let pool = test_pool().await;
        video(&pool, "old-id", None).await;
        let mut moved = meta("new-id", 1);
        moved.webpage_url = Some("https://example.com/old-id".into());
        let info = UrlInfo { title: "x".into(), is_playlist: false, entries: vec![moved] };
        let plan = plan(&pool, &info, "u", Format::Video).await.unwrap();
        assert_eq!(plan.jobs[0].video_id, "old-id");
        assert_eq!(count(&pool, "videos").await, 1);
    }

    #[tokio::test]
    async fn an_empty_playlist_is_an_error() {
        let pool = test_pool().await;
        let message = plan(&pool, &playlist(vec![]), LIST_URL, Format::Video).await.unwrap_err().to_string();
        assert!(message.contains("empty or private"), "{message}");
    }
}
