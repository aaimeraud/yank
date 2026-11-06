//! Asking yt-dlp what a URL points to, and turning its JSON into [`UrlInfo`].

use super::args::info_args;
use super::output::NO_REASON;
use super::toolchain::Toolchain;
use crate::error::{AppError, AppResult};
use crate::models::{Metadata, UrlInfo};
use serde_json::Value;
use std::time::Duration;

/// `limit` caps how long yt-dlp may take; None waits for it (enqueueing a
/// 2,000-video channel legitimately takes a while).
pub async fn fetch(toolchain: &Toolchain, url: &str, cookies: Option<&str>, limit: Option<Duration>) -> AppResult<UrlInfo> {
    let stdout = run(toolchain, info_args(url, cookies), limit, None).await?;
    parse(&stdout)
}

/// Looking inside a playlist for the YouTube screen, which shows one at a
/// time: opening another (or Play all again) stops the previous lookup.
pub async fn inspect(toolchain: &Toolchain, url: &str, cookies: Option<&str>, limit: Duration) -> AppResult<UrlInfo> {
    static IN_FLIGHT: std::sync::LazyLock<Slot> = std::sync::LazyLock::new(Slot::default);
    let stdout = run(toolchain, info_args(url, cookies), Some(limit), Some(&IN_FLIGHT)).await?;
    parse(&stdout)
}

/// Run yt-dlp with `args` and return its stdout, or its error line. With a
/// `limit`, a run that takes longer is stopped and reported as such, so a
/// hung network call cannot leave a spinner forever. yt-dlp runs in its own
/// process group and the whole group is stopped, deno included (it solves
/// YouTube's JS challenge in a child process).
///
/// With a `slot`, only one run holds it at a time: starting a run stops
/// the one it replaces (a new search outdates the old one, whose answer
/// the UI would drop anyway).
pub async fn run(
    toolchain: &Toolchain,
    args: Vec<String>,
    limit: Option<Duration>,
    slot: Option<&Slot>,
) -> AppResult<Vec<u8>> {
    let mut command = toolchain.command();
    command
        .args(args)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .process_group(0)
        .kill_on_drop(true);
    let child = command
        .spawn()
        .map_err(|e| AppError::YtDlp(format!("Could not start yt-dlp: {e}")))?;
    let pid = child.id();
    let _held = slot.map(|slot| slot.take(pid));
    let pending = child.wait_with_output();
    let finished = match limit {
        Some(limit) => match tokio::time::timeout(limit, pending).await {
            Ok(done) => done,
            Err(_) => {
                if let Some(pid) = pid {
                    crate::downloads::terminate_group(pid);
                }
                return Err(AppError::YtDlp(format!("yt-dlp did not answer within {} seconds.", limit.as_secs())));
            }
        },
        None => pending.await,
    };
    let output = finished.map_err(|e| AppError::YtDlp(format!("yt-dlp stopped unexpectedly: {e}")))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::YtDlp(error_summary(&stderr)));
    }
    Ok(output.stdout)
}

/// The process group of the one run allowed at a time, for [`run`].
#[derive(Default)]
pub struct Slot(std::sync::Mutex<Option<u32>>);

impl Slot {
    /// Hold the slot for `pid`, stopping whoever held it. Released when
    /// the guard drops, unless a newer run took it over meanwhile.
    fn take(&self, pid: Option<u32>) -> SlotGuard<'_> {
        let previous = std::mem::replace(&mut *self.0.lock().unwrap(), pid);
        if let Some(old) = previous {
            crate::downloads::terminate_group(old);
        }
        SlotGuard { slot: self, pid }
    }
}

struct SlotGuard<'a> {
    slot: &'a Slot,
    pid: Option<u32>,
}

impl Drop for SlotGuard<'_> {
    fn drop(&mut self) {
        let mut held = self.slot.0.lock().unwrap();
        if *held == self.pid {
            *held = None;
        }
    }
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
        .unwrap_or_else(|| NO_REASON.to_string())
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
        live_status: str_field(v, "live_status"),
    }
}

/// A downloadable URL for one entry. Flat YouTube entries sometimes carry a
/// bare id in `url`; rebuild the watch URL so yt-dlp does not have to guess.
pub(super) fn entry_url(v: &Value) -> Option<String> {
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

pub(super) fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(Value::as_str).map(String::from)
}

pub(super) fn first_str(v: &Value, keys: &[&str]) -> Option<String> {
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
    fn keeps_the_live_status_of_entries() {
        let json = br#"{"_type":"playlist","title":"P","entries":[
            {"_type":"url","id":"a","url":"https://www.youtube.com/watch?v=a","title":"Radio","live_status":"is_live"},
            {"_type":"url","id":"b","url":"https://www.youtube.com/watch?v=b","title":"Song"}]}"#;
        let info = parse(json).unwrap();
        assert_eq!(info.entries[0].live_status.as_deref(), Some("is_live"));
        assert_eq!(info.entries[1].live_status, None);
    }

    /// A lookup that hangs is stopped at its limit, children included.
    #[tokio::test]
    async fn a_run_over_its_limit_is_stopped_with_its_children() {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::db::fixtures::temp_dir("hung-yt-dlp");
        let marker = dir.join("child.pid");
        let script = dir.join("yt-dlp");
        std::fs::write(&script, format!("#!/bin/sh\nsleep 30 &\necho $! > '{}'\nwait\n", marker.display())).unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let toolchain = Toolchain { ytdlp: Some(script), ffmpeg: None, deno: None };
        let started = std::time::Instant::now();
        let error = run(&toolchain, vec![], Some(Duration::from_secs(2)), None).await.unwrap_err();
        assert!(error.to_string().contains("did not answer"), "{error}");
        assert!(started.elapsed() < Duration::from_secs(20), "stopped at the limit, not at the child's 30 s");
        // The script wrote its child's pid long before the 2 s limit, even
        // on a loaded machine; give the kill a moment to land.
        let child = std::fs::read_to_string(&marker).expect("the fake yt-dlp started its child");
        // The kill lands asynchronously; a loaded machine gets 5 s.
        let alive = || std::process::Command::new("kill").args(["-0", child.trim()]).status().unwrap().success();
        for _ in 0..50 {
            if !alive() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        assert!(!alive(), "the child {child} outlived the timeout");
        let _ = std::fs::remove_dir_all(dir);
    }

    /// A second run in the same slot stops the first one at once.
    #[tokio::test]
    async fn a_newer_run_in_the_slot_stops_the_older_one() {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::db::fixtures::temp_dir("slot-yt-dlp");
        let script = dir.join("yt-dlp");
        std::fs::write(&script, "#!/bin/sh\nsleep 1.5\necho done\n").unwrap();
        // (1.5 s each: run back to back they would take 3 s; the older is stopped.)
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let toolchain = Toolchain { ytdlp: Some(script), ffmpeg: None, deno: None };
        let slot = Slot::default();
        let started = std::time::Instant::now();
        let older = run(&toolchain, vec![], None, Some(&slot));
        let newer = async {
            tokio::time::sleep(Duration::from_millis(300)).await;
            run(&toolchain, vec![], None, Some(&slot)).await
        };
        let (older, newer) = tokio::join!(older, newer);
        assert!(older.is_err(), "the replaced run was stopped");
        assert_eq!(String::from_utf8(newer.unwrap()).unwrap().trim(), "done");
        assert!(started.elapsed() < Duration::from_secs(20));
        assert!(slot.0.lock().unwrap().is_none(), "released when the last run ended");
        let _ = std::fs::remove_dir_all(dir);
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
        assert_eq!(error_summary(""), NO_REASON);
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_youtube_channel_is_a_playlist() {
        let toolchain = Toolchain::detect();
        let info = fetch(&toolchain, "https://www.youtube.com/@RickAstleyYT/videos", None, None).await.unwrap();
        assert!(info.is_playlist && info.entries.len() > 1);
        assert!(info.entries.iter().all(|e| e.webpage_url.as_deref().is_some_and(|u| u.starts_with("http"))));
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_youtube_video_is_not_a_playlist() {
        let toolchain = Toolchain::detect();
        let info = fetch(&toolchain, "https://www.youtube.com/watch?v=jNQXAC9IVRw", None, None).await.unwrap();
        assert!(!info.is_playlist);
        assert_eq!(info.entries.len(), 1);
    }
}
