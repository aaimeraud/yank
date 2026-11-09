//! What a URL can be downloaded as, and how much disk each choice takes.
//!
//! yt-dlp is asked once (the same lookup as enqueueing) and its format list
//! is read here. The list is sorted worst to best, so "the best format
//! matching a selector" is simply the last match: [`pick`] walks the very
//! selectors `args::format_selector` hands to yt-dlp, which keeps the size
//! shown for a choice tied to the file that choice downloads.

use super::args::info_args;
use super::info::{self, Slot};
use super::toolchain::Toolchain;
use crate::error::AppResult;
use crate::models::{Format, QualityChoice, QualityOption};
use serde_json::Value;
use std::time::Duration;

/// A lookup takes a few seconds; a minute means it hung.
const LOOKUP_LIMIT: Duration = Duration::from_secs(60);

/// Highest resolution first. A cap only becomes a row when a format fits it.
const CAPS: [Format; 6] = [
    Format::Max2160,
    Format::Max1440,
    Format::Max1080,
    Format::Max720,
    Format::Max480,
    Format::Max360,
];

/// The qualities offered for `url`. Opening the picker for another video
/// stops the previous lookup.
pub async fn list(toolchain: &Toolchain, url: &str, cookies: Option<&str>) -> AppResult<QualityChoice> {
    static IN_FLIGHT: std::sync::LazyLock<Slot> = std::sync::LazyLock::new(Slot::default);
    let stdout = info::run(toolchain, info_args(url, cookies), Some(LOOKUP_LIMIT), Some(&IN_FLIGHT)).await?;
    parse(&stdout)
}

/// Turn yt-dlp's JSON into rows. A playlist is listed flat, without formats:
/// its videos differ, so it gets the usual caps and no sizes.
pub fn parse(bytes: &[u8]) -> AppResult<QualityChoice> {
    let root: Value = serde_json::from_slice(bytes)?;
    let title = root.get("title").and_then(Value::as_str).unwrap_or("Untitled").to_string();
    if root.get("entries").is_some() {
        return Ok(QualityChoice { title, is_playlist: true, options: playlist_options() });
    }
    let duration = root.get("duration").and_then(Value::as_f64);
    let formats: Vec<Stream> = root
        .get("formats")
        .and_then(Value::as_array)
        .map(|list| list.iter().map(Stream::read).collect())
        .unwrap_or_default();
    Ok(QualityChoice { title, is_playlist: false, options: options(&formats, duration) })
}

/// One entry of yt-dlp's `formats`. Codecs keep yt-dlp's three states:
/// the text `none` (absent), a codec name, or missing (unknown).
#[derive(Debug, Clone)]
struct Stream {
    id: String,
    ext: String,
    height: Option<u32>,
    vcodec: Option<String>,
    acodec: Option<String>,
    filesize: Option<f64>,
    filesize_approx: Option<f64>,
    /// Kilobits per second.
    tbr: Option<f64>,
}

impl Stream {
    fn read(v: &Value) -> Self {
        let text = |key: &str| v.get(key).and_then(Value::as_str).map(String::from);
        let number = |key: &str| v.get(key).and_then(Value::as_f64);
        Self {
            id: text("format_id").unwrap_or_default(),
            ext: text("ext").unwrap_or_default(),
            height: number("height").map(|h| h as u32),
            vcodec: text("vcodec"),
            acodec: text("acodec"),
            filesize: number("filesize"),
            filesize_approx: number("filesize_approx"),
            tbr: number("tbr"),
        }
    }

    fn has_video(&self) -> bool {
        self.vcodec.as_deref() != Some("none")
    }

    fn has_audio(&self) -> bool {
        self.acodec.as_deref() != Some("none")
    }

    fn video_only(&self) -> bool {
        self.has_video() && !self.has_audio()
    }

    fn audio_only(&self) -> bool {
        self.has_audio() && !self.has_video()
    }

    fn combined(&self) -> bool {
        self.has_video() && self.has_audio()
    }

    fn fits(&self, cap: u32) -> bool {
        self.height.is_some_and(|height| height <= cap)
    }

    fn is_h264(&self) -> bool {
        self.vcodec.as_deref().is_some_and(|codec| codec.starts_with("avc1"))
    }

    fn mp4(&self) -> bool {
        self.ext == "mp4"
    }

    fn m4a(&self) -> bool {
        self.ext == "m4a"
    }

    /// Bytes, and whether that number is an estimate. Streams delivered in
    /// segments often announce no size, so the bitrate has to do.
    fn size(&self, duration: Option<f64>) -> Option<(f64, bool)> {
        if let Some(exact) = self.filesize {
            return Some((exact, false));
        }
        if let Some(approx) = self.filesize_approx {
            return Some((approx, true));
        }
        Some((self.tbr? * 125.0 * duration?, true))
    }
}

/// The streams a [`Format`] downloads: one, or a video and an audio to merge.
fn pick(format: Format, formats: &[Stream]) -> Vec<Stream> {
    let last = |test: &dyn Fn(&Stream) -> bool| formats.iter().rfind(|f| test(f)).cloned();
    let m4a = || last(&|f| f.audio_only() && f.m4a());
    let pair = |video: Option<Stream>, audio: Option<Stream>| Some(vec![video?, audio?]);
    let single = |stream: Option<Stream>| stream.map(|s| vec![s]);
    // `bestvideo*+bestaudio`: a stream that already has sound is not merged.
    let star = |video: Option<Stream>| match video {
        Some(stream) if stream.has_audio() => Some(vec![stream]),
        other => pair(other, last(&Stream::audio_only)),
    };

    let found = match format {
        Format::Audio => single(m4a().or_else(|| last(&Stream::audio_only))),
        Format::Original => star(last(&Stream::has_video)).or_else(|| single(last(&Stream::combined))),
        Format::Video => pair(last(&|f| f.video_only() && f.is_h264() && f.mp4()), m4a())
            .or_else(|| pair(last(&|f| f.video_only() && f.mp4()), m4a()))
            .or_else(|| single(last(&|f| f.combined() && f.mp4())))
            .or_else(|| single(last(&Stream::combined))),
        capped => {
            let cap = capped.max_height().unwrap_or(u32::MAX);
            if capped.prefers_h264() {
                pair(last(&|f| f.video_only() && f.is_h264() && f.mp4() && f.fits(cap)), m4a())
                    .or_else(|| pair(last(&|f| f.video_only() && f.mp4() && f.fits(cap)), m4a()))
                    .or_else(|| single(last(&|f| f.combined() && f.mp4() && f.fits(cap))))
                    .or_else(|| single(last(&|f| f.combined() && f.fits(cap))))
            } else {
                star(last(&|f| f.has_video() && f.fits(cap))).or_else(|| single(last(&|f| f.combined() && f.fits(cap))))
            }
        }
    };
    found.unwrap_or_default()
}

fn options(formats: &[Stream], duration: Option<f64>) -> Vec<QualityOption> {
    let mut rows: Vec<QualityOption> = Vec::new();
    let mut seen: Vec<Vec<String>> = Vec::new();
    for cap in CAPS {
        let streams = pick(cap, formats);
        let Some(video) = streams.iter().find(|s| s.has_video()) else { continue };
        let height = video.height.unwrap_or(0);
        // Above 1080p YouTube has no H.264: a 4K cap on a 1080p video would
        // only repeat that row in a codec the player may not open.
        if !cap.prefers_h264() && height <= 1080 {
            continue;
        }
        let ids: Vec<String> = streams.iter().map(|s| s.id.clone()).collect();
        // Caps run high to low: keep the tightest one that gives this file,
        // so a 720p video is recorded as 720p and not as "up to 1080p".
        if let Some(row) = seen.iter().position(|known| *known == ids) {
            rows[row].format = cap;
            continue;
        }
        seen.push(ids);
        rows.push(video_row(cap, video, &streams, duration));
    }
    // No height to cap on, or nothing the H.264 selectors accept (a site
    // with only separate WebM streams): the kinds without a limit still work.
    for fallback in [Format::Video, Format::Original] {
        if rows.is_empty() {
            let streams = pick(fallback, formats);
            if let Some(video) = streams.iter().find(|s| s.has_video()) {
                rows.push(video_row(fallback, video, &streams, duration));
            }
        }
    }
    let audio = pick(Format::Audio, formats);
    if let Some(track) = audio.first() {
        let (size, approximate) = total_size(&audio, duration);
        rows.push(QualityOption {
            format: Format::Audio,
            label: "Audio only".into(),
            detail: track.ext.to_uppercase(),
            size,
            approximate,
            plays_in_app: true,
        });
    }
    if rows.is_empty() {
        // Sites that describe no formats still download fine.
        rows.push(unsized_row(Format::Video, "Best for this app", "MP4 when available", true));
    }
    rows
}

fn video_row(format: Format, video: &Stream, streams: &[Stream], duration: Option<f64>) -> QualityOption {
    let (size, approximate) = total_size(streams, duration);
    let plays_in_app = video.is_h264() || (video.mp4() && video.vcodec.is_none());
    QualityOption {
        format,
        label: video.height.map_or_else(|| "Video".to_string(), |height| format!("{height}p")),
        detail: codec_name(video),
        size,
        approximate,
        plays_in_app,
    }
}

/// None as soon as one stream has no known size: half a total would lie.
fn total_size(streams: &[Stream], duration: Option<f64>) -> (Option<i64>, bool) {
    let mut bytes = 0.0;
    let mut approximate = false;
    for stream in streams {
        let Some((size, estimate)) = stream.size(duration) else { return (None, false) };
        bytes += size;
        approximate |= estimate;
    }
    (Some(bytes.round() as i64), approximate)
}

fn codec_name(video: &Stream) -> String {
    let codec = video.vcodec.as_deref().unwrap_or("");
    let name = match codec {
        c if c.starts_with("avc1") || c.starts_with("h264") => "H.264",
        c if c.starts_with("vp09") || c.starts_with("vp9") => "VP9",
        c if c.starts_with("av01") => "AV1",
        c if c.starts_with("hev1") || c.starts_with("hvc1") => "HEVC",
        _ => return video.ext.to_uppercase(),
    };
    format!("{name} · {}", video.ext.to_uppercase())
}

fn unsized_row(format: Format, label: &str, detail: &str, plays_in_app: bool) -> QualityOption {
    QualityOption { format, label: label.into(), detail: detail.into(), size: None, approximate: false, plays_in_app }
}

fn playlist_options() -> Vec<QualityOption> {
    vec![
        unsized_row(Format::Max1080, "Up to 1080p", "H.264 · MP4", true),
        unsized_row(Format::Max720, "Up to 720p", "H.264 · MP4", true),
        unsized_row(Format::Max480, "Up to 480p", "H.264 · MP4", true),
        unsized_row(Format::Max360, "Up to 360p", "H.264 · MP4", true),
        unsized_row(Format::Original, "Best available", "Any codec", false),
        unsized_row(Format::Audio, "Audio only", "M4A", true),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A trimmed copy of a real YouTube list, worst to best, as yt-dlp sorts it.
    const YOUTUBE: &str = r#"{"title":"Sample","duration":100,"formats":[
        {"format_id":"mhtml","ext":"mhtml","vcodec":"none","acodec":"none"},
        {"format_id":"139","ext":"m4a","vcodec":"none","acodec":"mp4a.40.5","filesize":1000},
        {"format_id":"251","ext":"webm","vcodec":"none","acodec":"opus","filesize":4000},
        {"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","filesize":2000},
        {"format_id":"134","ext":"mp4","height":360,"vcodec":"avc1.4D401E","acodec":"none","filesize":10000},
        {"format_id":"18","ext":"mp4","height":360,"vcodec":"avc1.42001E","acodec":"mp4a.40.2","filesize_approx":15000},
        {"format_id":"136","ext":"mp4","height":720,"vcodec":"avc1.4D401F","acodec":"none","filesize":30000},
        {"format_id":"398","ext":"mp4","height":720,"vcodec":"av01.0.08M","acodec":"none","filesize":25000},
        {"format_id":"312","ext":"mp4","height":1080,"vcodec":"avc1.64002A","acodec":"none","tbr":800},
        {"format_id":"303","ext":"webm","height":1080,"vcodec":"vp9","acodec":"none","filesize":70000},
        {"format_id":"308","ext":"webm","height":1440,"vcodec":"vp9","acodec":"none","filesize":200000},
        {"format_id":"401","ext":"mp4","height":2160,"vcodec":"av01.0.13M","acodec":"none","filesize":500000}
    ]}"#;

    fn rows(json: &str) -> Vec<QualityOption> {
        parse(json.as_bytes()).unwrap().options
    }

    fn row(rows: &[QualityOption], format: Format) -> QualityOption {
        rows.iter().find(|r| r.format == format).unwrap_or_else(|| panic!("no row for {format:?}")).clone()
    }

    #[test]
    fn lists_each_resolution_best_first_then_audio() {
        let labels: Vec<String> = rows(YOUTUBE).into_iter().map(|r| r.label).collect();
        assert_eq!(labels, ["2160p", "1440p", "1080p", "720p", "360p", "Audio only"]);
    }

    #[test]
    fn a_size_adds_the_video_and_the_audio_it_is_merged_with() {
        let list = rows(YOUTUBE);
        let hd = row(&list, Format::Max720);
        assert_eq!((hd.size, hd.approximate), (Some(32_000), false));
        assert!(hd.plays_in_app);
        assert_eq!(hd.detail, "H.264 · MP4");
    }

    #[test]
    fn a_stream_without_a_size_is_estimated_from_its_bitrate() {
        // 800 kbit/s * 100 s = 10 MB, plus the 2000 bytes of audio.
        let full_hd = row(&rows(YOUTUBE), Format::Max1080);
        assert_eq!((full_hd.size, full_hd.approximate), (Some(10_002_000), true));
    }

    #[test]
    fn above_1080p_the_row_says_the_player_may_not_open_it() {
        let list = rows(YOUTUBE);
        let uhd = row(&list, Format::Max2160);
        assert_eq!(uhd.detail, "AV1 · MP4");
        assert!(!uhd.plays_in_app);
        // Best audio of any container: the 4 kB Opus track is sorted below
        // the M4A in this list, so the M4A is the one yt-dlp takes.
        assert_eq!(uhd.size, Some(502_000));
    }

    #[test]
    fn a_4k_cap_never_repeats_a_1080p_video() {
        let json = r#"{"title":"T","duration":10,"formats":[
            {"format_id":"140","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","filesize":10},
            {"format_id":"299","ext":"mp4","height":1080,"vcodec":"avc1.64002A","acodec":"none","filesize":100},
            {"format_id":"303","ext":"webm","height":1080,"vcodec":"vp9","acodec":"none","filesize":90}]}"#;
        let labels: Vec<String> = rows(json).into_iter().map(|r| r.label).collect();
        assert_eq!(labels, ["1080p", "Audio only"]);
    }

    #[test]
    fn caps_that_land_on_the_same_streams_make_one_row() {
        // 576p: the 1080 and 720 caps both select it, and no other.
        let json = r#"{"title":"T","duration":10,"formats":[
            {"format_id":"a","ext":"mp4","height":576,"vcodec":"avc1.4D","acodec":"mp4a.40.2","filesize":100}]}"#;
        let list = rows(json);
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].label.as_str(), list[0].format), ("576p", Format::Max720));
    }

    #[test]
    fn one_unknown_part_makes_the_whole_size_unknown() {
        let json = r#"{"title":"T","formats":[
            {"format_id":"a","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","filesize":10},
            {"format_id":"v","ext":"mp4","height":720,"vcodec":"avc1.4D","acodec":"none"}]}"#;
        assert_eq!(row(&rows(json), Format::Max720).size, None);
    }

    #[test]
    fn a_site_without_a_format_list_still_offers_a_download() {
        let list = rows(r#"{"title":"Plain file"}"#);
        assert_eq!(list.len(), 1);
        assert_eq!((list[0].format, list[0].size), (Format::Video, None));
    }

    #[test]
    fn a_format_without_heights_becomes_the_default_video_row() {
        let json = r#"{"title":"T","formats":[{"format_id":"0","ext":"mp4","filesize":42}]}"#;
        let list = rows(json);
        assert_eq!(list[0].format, Format::Video);
        assert_eq!(list[0].size, Some(42));
        assert!(list[0].plays_in_app);
    }

    #[test]
    fn a_playlist_gets_caps_and_no_sizes() {
        let choice = parse(br#"{"_type":"playlist","title":"List","entries":[{"id":"a"}]}"#).unwrap();
        assert!(choice.is_playlist);
        assert_eq!(choice.options[0].format, Format::Max1080);
        assert!(choice.options.iter().all(|r| r.size.is_none()));
    }

    #[test]
    fn a_stream_that_has_sound_is_not_merged_with_another() {
        let json = r#"{"title":"T","duration":10,"formats":[
            {"format_id":"a","ext":"m4a","vcodec":"none","acodec":"mp4a.40.2","filesize":10},
            {"format_id":"uhd","ext":"webm","height":2160,"vcodec":"vp9","acodec":"opus","filesize":1000}]}"#;
        assert_eq!(row(&rows(json), Format::Max2160).size, Some(1000));
    }

    #[test]
    fn a_site_with_only_separate_webm_streams_still_offers_the_video() {
        let json = r#"{"title":"T","duration":10,"formats":[
            {"format_id":"a","ext":"webm","vcodec":"none","acodec":"opus","filesize":10},
            {"format_id":"v","ext":"webm","height":720,"vcodec":"vp9","acodec":"none","filesize":100}]}"#;
        let list = rows(json);
        assert_eq!((list[0].format, list[0].size), (Format::Original, Some(110)));
        assert!(!list[0].plays_in_app);
    }

    #[test]
    fn garbage_is_an_error() {
        assert!(parse(b"not json").is_err());
    }

    /// The promise of this module, against the real thing: for every row,
    /// yt-dlp itself selects the streams the size was computed from.
    /// Run with `cargo test -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_rows_match_what_ytdlp_selects() {
        use crate::ytdlp::args::format_selector;
        const URL: &str = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
        let toolchain = Toolchain::detect();
        let bytes = info::run(&toolchain, info_args(URL, None), Some(LOOKUP_LIMIT), None).await.unwrap();
        let root: Value = serde_json::from_slice(&bytes).unwrap();
        let formats: Vec<Stream> = root["formats"].as_array().unwrap().iter().map(Stream::read).collect();
        let duration = root["duration"].as_f64();
        let list = options(&formats, duration);
        assert!(list.len() > 3, "{list:?}");
        for row in list {
            let args = vec![
                "--no-warnings".to_string(),
                "--simulate".to_string(),
                "--no-playlist".to_string(),
                "-f".to_string(),
                format_selector(row.format),
                "--print".to_string(),
                "format_id".to_string(),
                "--".to_string(),
                URL.to_string(),
            ];
            let out = info::run(&toolchain, args, Some(LOOKUP_LIMIT), None).await.unwrap();
            let selected = String::from_utf8_lossy(&out).trim().replace('+', " ");
            let ours: Vec<String> = pick(row.format, &formats).into_iter().map(|s| s.id).collect();
            let mut theirs: Vec<&str> = selected.split_whitespace().collect();
            let mut mine: Vec<&str> = ours.iter().map(String::as_str).collect();
            theirs.sort_unstable();
            mine.sort_unstable();
            assert_eq!(theirs, mine, "{:?}", row.format);
        }
    }
}
