//! Asking yt-dlp what a URL points to, and turning its JSON into [`UrlInfo`].

use super::args::info_args;
use super::toolchain::Toolchain;
use crate::error::{AppError, AppResult};
use crate::models::{Metadata, UrlInfo};
use serde_json::Value;

pub async fn fetch(toolchain: &Toolchain, url: &str, cookies: Option<&str>) -> AppResult<UrlInfo> {
    let output = tokio::process::Command::new(toolchain.ytdlp_program())
        .args(toolchain.common_args())
        .args(info_args(url, cookies))
        .output()
        .await
        .map_err(|e| AppError::YtDlp(format!("Could not start yt-dlp: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::YtDlp(error_summary(&stderr)));
    }
    parse(&output.stdout)
}

/// The line worth showing from yt-dlp's stderr: the last `ERROR:` line, else
/// the last non-empty line.
pub fn error_summary(stderr: &str) -> String {
    let lines: Vec<&str> = stderr.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    lines
        .iter()
        .rev()
        .find(|line| line.starts_with("ERROR:"))
        .or_else(|| lines.last())
        .map(|line| line.to_string())
        .unwrap_or_else(|| "yt-dlp failed without saying why.".to_string())
}

/// `--dump-single-json` prints one object: a video, or a playlist whose
/// `entries` are flat references. Positions are taken from the array order,
/// not yt-dlp's `playlist_index`, which skips unavailable entries and would
/// leave holes in the numbering.
pub fn parse(bytes: &[u8]) -> AppResult<UrlInfo> {
    let root: Value = serde_json::from_slice(bytes)?;
    let entries_json = root.get("entries").and_then(Value::as_array);
    let is_playlist = str_field(&root, "_type").as_deref() == Some("playlist") || entries_json.is_some();

    let mut entries: Vec<Metadata> = match entries_json {
        Some(list) => list
            .iter()
            .filter(|entry| !entry.is_null())
            .map(to_metadata)
            .filter(|meta| !meta.id.is_empty() || meta.webpage_url.is_some())
            .collect(),
        None => vec![to_metadata(&root)],
    };
    for (position, entry) in entries.iter_mut().enumerate() {
        entry.index = position as i64 + 1;
    }

    let title = str_field(&root, "title")
        .or_else(|| entries.first().map(|entry| entry.title.clone()))
        .unwrap_or_else(|| "Playlist".to_string());
    Ok(UrlInfo { title, is_playlist, entries })
}

fn to_metadata(v: &Value) -> Metadata {
    Metadata {
        id: str_field(v, "id").unwrap_or_default(),
        title: str_field(v, "title").unwrap_or_else(|| "Untitled".to_string()),
        uploader: first_str(v, &["uploader", "channel", "creator"]).or_else(|| {
            v.get("creators")
                .and_then(Value::as_array)
                .and_then(|list| list.first())
                .and_then(Value::as_str)
                .map(String::from)
        }),
        // Flat entries report fractional seconds.
        duration: v.get("duration").and_then(Value::as_f64).map(|d| d as i64),
        thumbnail: str_field(v, "thumbnail").or_else(|| {
            v.get("thumbnails")
                .and_then(Value::as_array)
                .and_then(|list| list.last())
                .and_then(|t| str_field(t, "url"))
        }),
        extractor: first_str(v, &["extractor", "ie_key", "extractor_key"]),
        webpage_url: entry_url(v),
        index: 1,
    }
}

/// A downloadable URL for one entry. Flat YouTube entries sometimes carry a
/// bare id in `url`; rebuild the watch URL so yt-dlp does not have to guess.
fn entry_url(v: &Value) -> Option<String> {
    if let Some(page) = str_field(v, "webpage_url").filter(|u| u.starts_with("http")) {
        return Some(page);
    }
    let raw = str_field(v, "url").filter(|u| !u.is_empty())?;
    if raw.starts_with("http") {
        return Some(raw);
    }
    let extractor = first_str(v, &["extractor", "ie_key", "extractor_key"]).unwrap_or_default();
    if extractor.to_lowercase().contains("youtube") {
        return Some(format!("https://www.youtube.com/watch?v={raw}"));
    }
    Some(raw)
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

fn first_str(v: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| str_field(v, key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_playlist_with_absolute_entry_urls() {
        let json = br#"{"_type":"playlist","title":"My List","entries":[
            {"_type":"url","ie_key":"Youtube","id":"abc","url":"https://www.youtube.com/watch?v=abc","title":"One","duration":61,"thumbnails":[{"url":"https://img/1.jpg"}]},
            {"_type":"url","ie_key":"Youtube","id":"def","url":"https://www.youtube.com/watch?v=def","title":"Two","duration":62.5}]}"#;
        let info = parse(json).unwrap();
        assert!(info.is_playlist);
        assert_eq!(info.title, "My List");
        assert_eq!(info.entries.len(), 2);
        let first = &info.entries[0];
        assert_eq!(first.webpage_url.as_deref(), Some("https://www.youtube.com/watch?v=abc"));
        assert_eq!(first.thumbnail.as_deref(), Some("https://img/1.jpg"));
        assert_eq!((first.index, info.entries[1].index), (1, 2));
        assert_eq!(info.entries[1].duration, Some(62));
        assert_eq!(info.entries[1].extractor.as_deref(), Some("Youtube"));
    }

    #[test]
    fn expands_bare_youtube_ids() {
        let json = br#"{"_type":"url","ie_key":"Youtube","id":"abc","url":"abc","title":"Bare"}"#;
        let info = parse(json).unwrap();
        assert!(!info.is_playlist);
        assert_eq!(info.entries[0].webpage_url.as_deref(), Some("https://www.youtube.com/watch?v=abc"));
    }

    #[test]
    fn a_single_video_is_one_entry() {
        let json = br#"{"_type":"video","id":"v1","title":"Solo","webpage_url":"https://x.com/a/status/1","extractor":"twitter","uploader":"Someone"}"#;
        let info = parse(json).unwrap();
        assert!(!info.is_playlist);
        assert_eq!(info.title, "Solo");
        assert_eq!(info.entries[0].extractor.as_deref(), Some("twitter"));
        assert_eq!(info.entries[0].uploader.as_deref(), Some("Someone"));
    }

    #[test]
    fn skips_null_entries_and_falls_back_to_the_first_title() {
        let json = br#"{"_type":"playlist","entries":[null,{"_type":"url","id":"x","title":"Only","url":"https://example.com/x"}]}"#;
        let info = parse(json).unwrap();
        assert_eq!(info.entries.len(), 1);
        assert_eq!(info.title, "Only");
        assert_eq!(info.entries[0].index, 1, "numbering ignores the hole");
    }

    #[test]
    fn error_summary_picks_the_error_line() {
        let stderr = "WARNING: something\nERROR: [youtube] abc: Private video\n\n";
        assert_eq!(error_summary(stderr), "ERROR: [youtube] abc: Private video");
        assert_eq!(error_summary("just one line"), "just one line");
        assert_eq!(error_summary(""), "yt-dlp failed without saying why.");
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_youtube_channel_is_a_playlist() {
        let toolchain = Toolchain::detect();
        let info = fetch(&toolchain, "https://www.youtube.com/@RickAstleyYT/videos", None).await.unwrap();
        assert!(info.is_playlist && info.entries.len() > 1);
        assert!(info.entries.iter().all(|e| e.webpage_url.as_deref().is_some_and(|u| u.starts_with("http"))));
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_youtube_video_is_not_a_playlist() {
        let toolchain = Toolchain::detect();
        let info = fetch(&toolchain, "https://www.youtube.com/watch?v=jNQXAC9IVRw", None).await.unwrap();
        assert!(!info.is_playlist);
        assert_eq!(info.entries.len(), 1);
    }
}
