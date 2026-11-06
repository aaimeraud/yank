//! Watching a video without downloading it (ADR 0010).
//!
//! YouTube serves its iOS and visionOS clients an HLS master playlist:
//! H.264 and AAC in adaptive bitrates, which WKWebView's `<video>` plays
//! natively, seeking and quality switching included. yt-dlp already solves
//! the signature challenge to find it, so streaming is one yt-dlp call that
//! prints the playlist's URL, handed to the app's one player.
//!
//! The progressive MP4 (format 18) is not a fallback worth having on
//! YouTube: it answers 403 to anything but yt-dlp's own requests. The direct
//! URL is kept only for other sites, where it often works.

use super::info;
use super::output::NO_REASON;
use super::Toolchain;
use crate::error::{AppError, AppResult};
use crate::models::Stream;
use std::time::Duration;

/// Resolving takes about 4 s (webpage, player API, JS challenge).
const LIMIT: Duration = Duration::from_secs(60);

/// The lookup running now. The player streams one video, so a lookup for
/// the next (Next pressed again) stops the one the user moved past.
static IN_FLIGHT: std::sync::LazyLock<info::Slot> = std::sync::LazyLock::new(info::Slot::default);

/// Marks our one line on stdout, so nothing else yt-dlp prints is mistaken
/// for it.
const PREFIX: &str = "YANK_STREAM:";

/// HLS first (any video stream of the master playlist leads to it), then a
/// single file with both tracks.
const SELECTOR: &str = "bv*[protocol^=m3u8]/b[protocol^=m3u8]/b[ext=mp4]/b";

pub async fn resolve(toolchain: &Toolchain, url: &str, cookies: Option<&str>) -> AppResult<Stream> {
    let stdout = info::run(toolchain, stream_args(url, cookies), Some(LIMIT), Some(&IN_FLIGHT)).await?;
    parse(&String::from_utf8_lossy(&stdout))
}

pub fn stream_args(url: &str, cookies: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--no-playlist".into(),
        "--no-warnings".into(),
        "-f".into(),
        SELECTOR.into(),
        // --print implies --simulate: nothing is downloaded. Tabs never
        // appear in these fields; missing ones print as "NA".
        "--print".into(),
        format!("{PREFIX}%(protocol)s\t%(manifest_url)s\t%(url)s\t%(live_status)s"),
    ];
    if let Some(path) = cookies {
        args.extend(["--cookies".into(), path.to_string()]);
    }
    args.push("--".into());
    args.push(url.to_string());
    args
}

/// Our line -> where to stream from. An HLS format streams from its master
/// playlist (all qualities and the audio), anything else from its own URL.
pub fn parse(stdout: &str) -> AppResult<Stream> {
    let line = stdout
        .lines()
        .rev()
        .find_map(|line| line.trim_end().strip_prefix(PREFIX))
        .ok_or_else(|| AppError::YtDlp(NO_REASON.to_string()))?;
    let mut fields = line.split('\t').map(|field| Some(field).filter(|f| !f.is_empty() && *f != "NA"));
    let mut next = || fields.next().flatten();
    let (protocol, manifest, direct, live) = (next(), next(), next(), next());
    let is_live = live == Some("is_live");
    let is_hls = protocol.is_some_and(|p| p.starts_with("m3u8"));
    let url = match (is_hls, manifest, direct) {
        (true, Some(master), _) => master,
        (_, _, Some(file)) => file,
        _ => return Err(AppError::user("This video cannot be streamed. Download it instead.")),
    };
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Err(AppError::user("This video cannot be streamed. Download it instead."));
    }
    // YouTube's direct files answer 403 to anything but yt-dlp itself: no
    // HLS for YouTube means no stream, said now rather than as a player
    // error later (ADR 0010).
    if !is_hls && url.contains(".googlevideo.com/") {
        return Err(AppError::user(
            "YouTube offered no stream for this video (it may need your cookies, or a yt-dlp update). Download it instead.",
        ));
    }
    Ok(Stream { url: url.to_string(), is_hls, is_live })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn asks_for_hls_first_and_prints_one_marked_line() {
        let args = stream_args("https://www.youtube.com/watch?v=abc", None);
        let at = args.iter().position(|a| a == "-f").unwrap();
        assert!(args[at + 1].starts_with("bv*[protocol^=m3u8]"));
        assert!(args.iter().any(|a| a.starts_with("YANK_STREAM:%(protocol)s\t%(manifest_url)s")));
        assert!(args.contains(&"--no-playlist".to_string()));
        assert_eq!(args[args.len() - 2..], ["--".to_string(), "https://www.youtube.com/watch?v=abc".to_string()]);
        let with_cookies = stream_args("u", Some("/c.txt"));
        assert!(with_cookies.windows(2).any(|w| w == ["--cookies", "/c.txt"]));
    }

    #[test]
    fn hls_streams_from_the_master_playlist() {
        let out = "YANK_STREAM:m3u8_native\thttps://manifest.googlevideo.com/api/manifest/hls_variant/x\thttps://manifest.googlevideo.com/api/manifest/hls_playlist/itag/230\tnot_live\n";
        let stream = parse(out).unwrap();
        assert_eq!(stream.url, "https://manifest.googlevideo.com/api/manifest/hls_variant/x");
        assert!(stream.is_hls && !stream.is_live);
    }

    #[test]
    fn a_live_stream_is_flagged() {
        let stream = parse("YANK_STREAM:m3u8_native\thttps://m/master\thttps://m/v\tis_live").unwrap();
        assert!(stream.is_live);
    }

    #[test]
    fn a_plain_file_streams_from_its_own_url() {
        let stream = parse("YANK_STREAM:https\tNA\thttps://video.twimg.com/a.mp4\tNA").unwrap();
        assert_eq!(stream.url, "https://video.twimg.com/a.mp4");
        assert!(!stream.is_hls && !stream.is_live);
    }

    #[test]
    fn a_youtube_file_without_hls_is_refused_up_front() {
        let error = parse("YANK_STREAM:https\tNA\thttps://rr3---sn-x.googlevideo.com/videoplayback?itag=18\tNA").unwrap_err();
        assert!(error.to_string().contains("Download it instead"), "{error}");
    }

    #[test]
    fn other_output_is_ignored_and_the_last_marked_line_wins() {
        let out = "[youtube] abc: Downloading webpage\nYANK_STREAM:https\tNA\thttps://a/1.mp4\tNA\nYANK_STREAM:https\tNA\thttps://a/2.mp4\tNA\n";
        assert_eq!(parse(out).unwrap().url, "https://a/2.mp4");
    }

    #[test]
    fn nothing_playable_is_an_error_not_a_bad_url() {
        assert!(parse("").is_err());
        assert!(parse("YANK_STREAM:m3u8_native\tNA\tNA\tNA").is_err());
        // DASH or a local path cannot go into <video src>.
        assert!(parse("YANK_STREAM:http_dash_segments\tNA\t/tmp/x\tNA").is_err());
    }

    #[tokio::test]
    #[ignore = "network access"]
    async fn live_youtube_video_resolves_to_an_hls_master_playlist() {
        let toolchain = Toolchain::detect();
        let stream = resolve(&toolchain, "https://www.youtube.com/watch?v=jNQXAC9IVRw", None).await.unwrap();
        assert!(stream.is_hls, "{stream:?}");
        assert!(stream.url.contains("/hls_variant/"), "{}", stream.url);
    }
}
