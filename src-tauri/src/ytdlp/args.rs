//! Building yt-dlp command lines. Pure functions, so every flag we pass is
//! covered by a unit test instead of discovered at runtime.

use super::output::{FILE_PREFIX, PROGRESS_PREFIX};
use crate::models::Format;
use std::path::PathBuf;

/// Everything that varies between two downloads.
#[derive(Debug, Clone, PartialEq)]
pub struct DownloadRequest {
    pub url: String,
    pub format: Format,
    /// The user's downloads folder.
    pub download_dir: PathBuf,
    /// Library folder name, already made safe for disk (see
    /// `db::folders::disk_name`). None files the video under its channel.
    pub folder: Option<String>,
    pub cookies: Option<String>,
}

/// Format selectors. `Video` prefers H.264 so WKWebView can play the file
/// (ADR 0002); each `/` is a fallback when the site has no such stream.
pub fn format_selector(format: Format) -> &'static str {
    match format {
        Format::Video => {
            "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]\
             /bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"
        }
        Format::Audio => "bestaudio[ext=m4a]/bestaudio",
        Format::Original => "bestvideo*+bestaudio/best",
    }
}

/// Where the file goes. `%(title).150B` caps the name in bytes: a tweet's
/// "title" is its whole text and would exceed the 255-byte filename limit.
/// `%(channel,uploader|Unknown)s` tries channel, then uploader, then the
/// literal default after `|`.
///
/// Our own path parts (the downloads folder, the library folder name) are
/// escaped: yt-dlp reads every `%` in `-o` as the start of a field, so a
/// playlist called "Top 10% Hits" would otherwise produce a mangled path.
pub fn output_template(download_dir: &std::path::Path, folder: Option<&str>) -> String {
    let mut template = escape_percent(&download_dir.display().to_string());
    template.push('/');
    match folder {
        Some(name) => template.push_str(&escape_percent(name)),
        None => template.push_str("%(channel,uploader|Unknown)s"),
    }
    template.push_str("/%(title).150B [%(id)s].%(ext)s");
    template
}

/// `%` -> `%%`, the literal-percent escape of yt-dlp's output template.
fn escape_percent(text: &str) -> String {
    text.trim_end_matches('/').replace('%', "%%")
}

/// The arguments for one download, without the toolchain flags.
pub fn download_args(request: &DownloadRequest) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "-f".into(),
        format_selector(request.format).into(),
    ];
    if request.format == Format::Video {
        args.extend(["--merge-output-format".into(), "mp4".into()]);
    }
    args.extend([
        // One progress line per update, in a format we parse (output.rs).
        "--newline".into(),
        "--progress".into(),
        "--progress-template".into(),
        format!(
            r#"download:{PROGRESS_PREFIX}{{"percent":%(progress._percent)s,"speed":"%(progress.speed)s","eta":"%(progress.eta)s"}}"#
        ),
        // The final path, printed once the file is merged and in place, even
        // when it was already on disk. --print implies --quiet, which is why
        // --progress is needed above.
        "--print".into(),
        format!("after_move:{FILE_PREFIX}%(filepath)s"),
        "--write-thumbnail".into(),
        "--convert-thumbnails".into(),
        "jpg".into(),
        "--no-playlist".into(),
        "-o".into(),
        output_template(&request.download_dir, request.folder.as_deref()),
    ]);
    push_cookies(&mut args, request.cookies.as_deref());
    args.push("--".into());
    args.push(request.url.clone());
    args
}

/// The arguments to ask what a URL is: one video, or a playlist and its
/// entries. `--flat-playlist` lists entries without resolving each one,
/// which keeps a 500-video playlist to a single request.
pub fn info_args(url: &str, cookies: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec![
        "--dump-single-json".into(),
        "--flat-playlist".into(),
        "--no-warnings".into(),
    ];
    push_cookies(&mut args, cookies);
    args.push("--".into());
    args.push(url.to_string());
    args
}

fn push_cookies(args: &mut Vec<String>, cookies: Option<&str>) {
    if let Some(path) = cookies {
        args.push("--cookies".into());
        args.push(path.to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(format: Format, folder: Option<&str>) -> DownloadRequest {
        DownloadRequest {
            url: "https://www.youtube.com/watch?v=abc".into(),
            format,
            download_dir: PathBuf::from("/Users/me/Movies/Yank"),
            folder: folder.map(String::from),
            cookies: None,
        }
    }

    fn value_after<'a>(args: &'a [String], flag: &str) -> Option<&'a str> {
        let at = args.iter().position(|arg| arg == flag)?;
        args.get(at + 1).map(String::as_str)
    }

    #[test]
    fn video_downloads_merge_to_mp4_and_print_machine_lines() {
        let args = download_args(&request(Format::Video, None));
        assert_eq!(value_after(&args, "--merge-output-format"), Some("mp4"));
        assert!(value_after(&args, "-f").unwrap().starts_with("bestvideo[vcodec^=avc1]"));
        assert_eq!(value_after(&args, "--print"), Some("after_move:YANK_FILE:%(filepath)s"));
        assert!(value_after(&args, "--progress-template").unwrap().starts_with("download:YANK_PROGRESS:{"));
        assert_eq!(args[args.len() - 2..], ["--".to_string(), "https://www.youtube.com/watch?v=abc".to_string()]);
    }

    #[test]
    fn audio_and_original_do_not_force_mp4() {
        for format in [Format::Audio, Format::Original] {
            let args = download_args(&request(format, None));
            assert_eq!(value_after(&args, "--merge-output-format"), None, "{format:?}");
            assert_eq!(value_after(&args, "-f"), Some(format_selector(format)));
        }
    }

    #[test]
    fn a_filed_video_lands_in_its_folder_otherwise_under_the_channel() {
        let filed = download_args(&request(Format::Video, Some("Sample Folder")));
        assert_eq!(
            value_after(&filed, "-o"),
            Some("/Users/me/Movies/Yank/Sample Folder/%(title).150B [%(id)s].%(ext)s")
        );
        let loose = download_args(&request(Format::Video, None));
        assert_eq!(
            value_after(&loose, "-o"),
            Some("/Users/me/Movies/Yank/%(channel,uploader|Unknown)s/%(title).150B [%(id)s].%(ext)s")
        );
    }

    /// Regression: a `%` in a folder or path became a template field.
    #[test]
    fn percent_signs_in_our_paths_are_escaped() {
        assert_eq!(
            output_template(&PathBuf::from("/Users/me/100% videos/"), Some("Top 10% Hits")),
            "/Users/me/100%% videos/Top 10%% Hits/%(title).150B [%(id)s].%(ext)s"
        );
    }

    #[test]
    fn cookies_are_passed_when_set() {
        let mut with_cookies = request(Format::Video, None);
        with_cookies.cookies = Some("/Users/me/cookies.txt".into());
        assert_eq!(value_after(&download_args(&with_cookies), "--cookies"), Some("/Users/me/cookies.txt"));
        assert_eq!(value_after(&info_args("u", Some("/c.txt")), "--cookies"), Some("/c.txt"));
        assert_eq!(value_after(&info_args("u", None), "--cookies"), None);
    }

    #[test]
    fn a_url_starting_with_a_dash_cannot_become_a_flag() {
        let args = info_args("--exec=rm", None);
        assert_eq!(args[args.len() - 2..], ["--".to_string(), "--exec=rm".to_string()]);
    }
}
