//! Searching YouTube through yt-dlp, for the YouTube screen.
//!
//! yt-dlp reads YouTube's own results page (`/results?search_query=…`) like
//! any playlist, so a search is one `--flat-playlist` call: no API key, the
//! same cookies and toolchain as a download, and the answer arrives in about
//! a second and a half. The `sp` parameter is YouTube's filter ("videos
//! only", "playlists only"); without it a page mixes channels, shelves and
//! shorts. Pages are `--playlist-items` ranges: yt-dlp follows YouTube's
//! continuation tokens up to the range's end.

use super::info::{self, entry_url, first_str, str_field};
use super::Toolchain;
use crate::error::{AppError, AppResult};
use crate::models::{SearchKind, SearchPage, SearchResult};
use serde_json::Value;
use std::sync::LazyLock;
use std::time::Duration;

/// Results per page. YouTube serves about 20 per continuation, so a page
/// costs one or two requests.
pub const PAGE_SIZE: usize = 24;

/// Longer than any query has taken in practice (1.5 s), short enough that a
/// stuck network call surfaces as an error the user can retry.
const LIMIT: Duration = Duration::from_secs(45);

/// The search running now. The screen shows one search at a time, so a new
/// one (or its next page) stops the yt-dlp of the one it replaces.
static IN_FLIGHT: LazyLock<info::Slot> = LazyLock::new(info::Slot::default);

/// Queries longer than this are cut: YouTube ignores the rest anyway.
const MAX_QUERY_CHARS: usize = 200;

pub async fn search(
    toolchain: &Toolchain,
    query: &str,
    kind: SearchKind,
    page: usize,
    cookies: Option<&str>,
) -> AppResult<SearchPage> {
    let query = clean_query(query).ok_or_else(|| AppError::user("Type something to search for."))?;
    let stdout = info::run(toolchain, search_args(&query, kind, page, cookies), Some(LIMIT), Some(&IN_FLIGHT)).await?;
    parse(&stdout, kind)
}

/// Trimmed, inner whitespace collapsed, capped; None when nothing is left.
pub fn clean_query(raw: &str) -> Option<String> {
    let joined = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let capped: String = joined.chars().take(MAX_QUERY_CHARS).collect();
    let capped = capped.trim_end().to_string();
    (!capped.is_empty()).then_some(capped)
}

/// YouTube's results page for `query`, filtered to one kind.
pub fn search_url(query: &str, kind: SearchKind) -> String {
    let filter = match kind {
        // Base64 protobufs from YouTube's own filter menu ("Type: Video",
        // "Type: Playlist"), already percent-encoded.
        SearchKind::Video => "EgIQAQ%3D%3D",
        SearchKind::Playlist => "EgIQAw%3D%3D",
    };
    format!("https://www.youtube.com/results?search_query={}&sp={filter}", form_encode(query))
}

/// `application/x-www-form-urlencoded`: what a browser sends for the query.
/// Unreserved characters stay, a space becomes `+`, every other byte of the
/// UTF-8 is `%XX`, so `&`, `#` and `+` in a query cannot break the URL.
fn form_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(byte as char),
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// The arguments for one page (0-based) of results.
pub fn search_args(query: &str, kind: SearchKind, page: usize, cookies: Option<&str>) -> Vec<String> {
    let first = page * PAGE_SIZE + 1;
    let last = first + PAGE_SIZE - 1;
    let mut args: Vec<String> = vec![
        "--dump-single-json".into(),
        "--flat-playlist".into(),
        "--no-warnings".into(),
        "--playlist-items".into(),
        format!("{first}:{last}"),
    ];
    if let Some(path) = cookies {
        args.extend(["--cookies".into(), path.to_string()]);
    }
    args.push("--".into());
    args.push(search_url(query, kind));
    args
}

/// yt-dlp's JSON for a results page -> the hits of the wanted kind. YouTube
/// sometimes slips another kind into a filtered page (a channel, a mix);
/// those are dropped, but still count toward `has_more`, which is about
/// whether YouTube had more to give.
pub fn parse(bytes: &[u8], kind: SearchKind) -> AppResult<SearchPage> {
    let root: Value = serde_json::from_slice(bytes)?;
    let entries = root.get("entries").and_then(Value::as_array).cloned().unwrap_or_default();
    let has_more = entries.len() >= PAGE_SIZE;
    let results = entries.iter().filter_map(to_result).filter(|hit| hit.kind == kind).collect();
    Ok(SearchPage { results, has_more })
}

fn to_result(v: &Value) -> Option<SearchResult> {
    let id = str_field(v, "id").filter(|id| !id.is_empty())?;
    let url = entry_url(v)?;
    let kind = if is_playlist_url(&url) {
        SearchKind::Playlist
    } else if url.contains("/watch?") || url.contains("/shorts/") {
        SearchKind::Video
    } else {
        // A channel or anything else we cannot play or queue as one item.
        return None;
    };
    Some(SearchResult {
        kind,
        id,
        title: str_field(v, "title").unwrap_or_else(|| "Untitled".to_string()),
        url,
        channel: first_str(v, &["channel", "uploader"]),
        duration: v.get("duration").and_then(Value::as_f64).map(|d| d as i64),
        view_count: v.get("view_count").and_then(Value::as_i64),
        thumbnail: best_thumbnail(v),
        live_status: str_field(v, "live_status"),
    })
}

/// A playlist link, not a video that happens to carry `&list=` (a video
/// opened from a playlist): `/playlist?list=` only.
fn is_playlist_url(url: &str) -> bool {
    url.contains("/playlist?") && url.contains("list=")
}

/// The widest thumbnail up to 720 px, the size a grid card shows at 2x;
/// anything bigger only costs bandwidth.
fn best_thumbnail(v: &Value) -> Option<String> {
    let list = v.get("thumbnails").and_then(Value::as_array)?;
    let width = |t: &Value| t.get("width").and_then(Value::as_i64).unwrap_or(0);
    list.iter()
        .filter(|t| width(t) <= 720)
        .max_by_key(|t| width(t))
        .or_else(|| list.last())
        .and_then(|t| str_field(t, "url"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const VIDEOS: &[u8] = include_bytes!("fixtures/search_videos.json");
    const PLAYLISTS: &[u8] = include_bytes!("fixtures/search_playlists.json");

    fn value_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        let at = args.iter().position(|arg| arg == flag)?;
        args.get(at + 1).map(String::as_str)
    }

    #[test]
    fn the_url_is_youtubes_results_page_with_its_type_filter() {
        assert_eq!(
            search_url("rust tutorial", SearchKind::Video),
            "https://www.youtube.com/results?search_query=rust+tutorial&sp=EgIQAQ%3D%3D"
        );
        assert!(search_url("x", SearchKind::Playlist).ends_with("&sp=EgIQAw%3D%3D"));
    }

    /// `&`, `#`, `+` and non-ASCII in a query must reach YouTube as text,
    /// not as URL syntax.
    #[test]
    fn queries_are_form_encoded() {
        assert_eq!(form_encode("tom & jerry #1 c++"), "tom+%26+jerry+%231+c%2B%2B");
        assert_eq!(form_encode("été"), "%C3%A9t%C3%A9");
        assert_eq!(form_encode("a-b_c.d~e"), "a-b_c.d~e");
    }

    #[test]
    fn pages_are_playlist_item_ranges() {
        let first = search_args("q", SearchKind::Video, 0, None);
        assert_eq!(value_after(&first, "--playlist-items"), Some("1:24"));
        let third = search_args("q", SearchKind::Video, 2, None);
        assert_eq!(value_after(&third, "--playlist-items"), Some("49:72"));
        assert!(third.contains(&"--flat-playlist".to_string()));
    }

    #[test]
    fn the_query_can_never_become_a_flag() {
        let args = search_args("--exec=rm -rf ~", SearchKind::Video, 0, Some("/c.txt"));
        assert_eq!(args[args.len() - 2], "--");
        assert!(args[args.len() - 1].starts_with("https://www.youtube.com/results?search_query=--exec%3Drm"));
        assert_eq!(value_after(&args, "--cookies"), Some("/c.txt"));
    }

    #[test]
    fn queries_are_trimmed_collapsed_and_capped() {
        assert_eq!(clean_query("  lofi   beats \n"), Some("lofi beats".to_string()));
        assert_eq!(clean_query(" \t "), None);
        assert_eq!(clean_query(&"é".repeat(500)).unwrap().chars().count(), MAX_QUERY_CHARS);
    }

    #[test]
    fn parses_real_video_results() {
        let page = parse(VIDEOS, SearchKind::Video).unwrap();
        assert_eq!(page.results.len(), 3);
        assert!(!page.has_more, "a 3-entry page is the last one");
        let first = &page.results[0];
        assert_eq!(first.kind, SearchKind::Video);
        assert_eq!(first.id, "rQ_J9WH6CGk");
        assert_eq!(first.url, "https://www.youtube.com/watch?v=rQ_J9WH6CGk");
        assert_eq!(first.channel.as_deref(), Some("BekBrace"));
        assert_eq!(first.duration, Some(11104));
        assert!(first.view_count.unwrap() > 0);
        assert!(first.thumbnail.as_deref().unwrap().starts_with("https://i.ytimg.com/vi/rQ_J9WH6CGk/"));
        assert_eq!(first.live_status, None);
    }

    #[test]
    fn a_live_stream_has_no_duration_and_says_so() {
        let page = parse(VIDEOS, SearchKind::Video).unwrap();
        let live = page.results.iter().find(|hit| hit.live_status.is_some()).unwrap();
        assert_eq!(live.live_status.as_deref(), Some("is_live"));
        assert_eq!(live.duration, None);
    }

    #[test]
    fn parses_real_playlist_results() {
        let page = parse(PLAYLISTS, SearchKind::Playlist).unwrap();
        assert_eq!(page.results.len(), 2);
        let first = &page.results[0];
        assert_eq!(first.kind, SearchKind::Playlist);
        assert!(first.id.starts_with("PL"));
        assert!(first.url.starts_with("https://www.youtube.com/playlist?list=PL"));
        assert_eq!(first.channel.as_deref(), Some("Let's Get Rusty"));
        assert_eq!(first.duration, None);
    }

    /// A filtered page can still carry a channel or a stray video; only the
    /// asked-for kind is returned.
    #[test]
    fn other_kinds_are_dropped_but_count_toward_has_more() {
        let mut entries: Vec<String> = (0..PAGE_SIZE - 1)
            .map(|i| format!(r#"{{"id":"PL{i}","url":"https://www.youtube.com/playlist?list=PL{i}","title":"P{i}"}}"#))
            .collect();
        entries.push(r#"{"id":"UCx","url":"https://www.youtube.com/channel/UCx","title":"A channel"}"#.into());
        let json = format!(r#"{{"_type":"playlist","entries":[{}]}}"#, entries.join(","));
        let page = parse(json.as_bytes(), SearchKind::Playlist).unwrap();
        assert_eq!(page.results.len(), PAGE_SIZE - 1);
        assert!(page.has_more, "a full page means YouTube may have more");
        assert!(parse(json.as_bytes(), SearchKind::Video).unwrap().results.is_empty());
    }

    #[test]
    fn a_video_opened_from_a_playlist_is_still_a_video() {
        assert!(!is_playlist_url("https://www.youtube.com/watch?v=abc&list=RDabc"));
        assert!(is_playlist_url("https://www.youtube.com/playlist?list=PLx"));
    }

    #[test]
    fn picks_the_widest_thumbnail_up_to_720() {
        let v: Value = serde_json::from_str(
            r#"{"thumbnails":[{"url":"s","width":360},{"url":"m","width":720},{"url":"l","width":1280}]}"#,
        )
        .unwrap();
        assert_eq!(best_thumbnail(&v).as_deref(), Some("m"));
        // yt-dlp lists thumbnails smallest first; without sizes the last wins.
        let no_sizes: Value = serde_json::from_str(r#"{"thumbnails":[{"url":"a"},{"url":"b"}]}"#).unwrap();
        assert_eq!(best_thumbnail(&no_sizes).as_deref(), Some("b"));
    }

    #[test]
    fn an_empty_answer_is_an_empty_last_page() {
        let page = parse(br#"{"_type":"playlist","entries":[]}"#, SearchKind::Video).unwrap();
        assert_eq!(page, SearchPage { results: vec![], has_more: false });
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_search_returns_full_pages_of_each_kind() {
        let toolchain = Toolchain::detect();
        let videos = search(&toolchain, "rust programming", SearchKind::Video, 0, None).await.unwrap();
        assert!(videos.results.len() >= PAGE_SIZE - 2 && videos.has_more, "{}", videos.results.len());
        assert!(videos.results.iter().all(|hit| hit.url.contains("youtube.com/")));
        let second = search(&toolchain, "rust programming", SearchKind::Video, 1, None).await.unwrap();
        // YouTube may repeat a hit across pages, but page two is mostly new.
        let new = second.results.iter().filter(|hit| !videos.results.iter().any(|v| v.id == hit.id)).count();
        assert!(new * 2 > second.results.len(), "{new} new of {}", second.results.len());
        let playlists = search(&toolchain, "rust programming", SearchKind::Playlist, 0, None).await.unwrap();
        assert!(!playlists.results.is_empty());
        assert!(playlists.results.iter().all(|hit| hit.kind == SearchKind::Playlist));
    }
}
