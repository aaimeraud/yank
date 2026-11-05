//! Reading what a yt-dlp download prints.
//!
//! The download is started with two machine-readable line formats on stdout
//! (see [`super::args`]): a progress line prefixed `YANK_PROGRESS:` and the
//! final file path prefixed `YANK_FILE:`. Anything else is ignored, so a
//! yt-dlp release that rewords its human messages cannot break us.

use serde::Deserialize;

pub const PROGRESS_PREFIX: &str = "YANK_PROGRESS:";
pub const FILE_PREFIX: &str = "YANK_FILE:";

#[derive(Debug, Clone, PartialEq)]
pub enum Line {
    Progress(Progress),
    /// Absolute path of the finished file, after merging and moving.
    File(String),
    Other,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Progress {
    /// 0 to 100. Resets to 0 when yt-dlp moves from the video to the audio
    /// stream of the same download.
    pub percent: f64,
    /// Bytes per second, or None while yt-dlp has no estimate.
    pub speed: Option<String>,
    /// Seconds left, or None while yt-dlp has no estimate.
    pub eta: Option<String>,
}

#[derive(Deserialize)]
struct RawProgress {
    percent: Option<f64>,
    speed: Option<String>,
    eta: Option<String>,
}

pub fn parse_line(line: &str) -> Line {
    if let Some(path) = line.strip_prefix(FILE_PREFIX) {
        let path = path.trim();
        return if path.is_empty() {
            Line::Other
        } else {
            Line::File(path.to_string())
        };
    }
    let Some(json) = line.strip_prefix(PROGRESS_PREFIX) else {
        return Line::Other;
    };
    match serde_json::from_str::<RawProgress>(json) {
        Ok(raw) => Line::Progress(Progress {
            percent: raw.percent.unwrap_or(0.0).clamp(0.0, 100.0),
            speed: known(raw.speed),
            eta: known(raw.eta),
        }),
        Err(_) => Line::Other,
    }
}

/// yt-dlp prints "NA" (or "None") for a value it does not know yet.
fn known(value: Option<String>) -> Option<String> {
    value.filter(|v| !v.is_empty() && v != "NA" && v != "None")
}

/// Errors worth a fresh extraction. A rejected signature (yt-dlp issue
/// 17395), a rate limit and a dropped connection clear up on their own; a bad
/// URL or a missing binary fails the same way every time. See ADR 0004.
pub fn is_transient_failure(stderr: &str) -> bool {
    const TRANSIENT: &[&str] = &[
        "HTTP Error 403",
        "HTTP Error 408",
        "HTTP Error 429",
        "HTTP Error 500",
        "HTTP Error 502",
        "HTTP Error 503",
        "HTTP Error 504",
        "timed out",
        "Connection reset",
        "Temporary failure",
        "Remote end closed connection",
    ];
    TRANSIENT.iter().any(|needle| stderr.contains(needle))
}

/// Shown when yt-dlp fails with an empty stderr.
pub const NO_REASON: &str = "yt-dlp failed without saying why.";

/// How many stderr lines a failed download keeps for diagnostics.
pub const STDERR_TAIL_LINES: usize = 20;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_progress_and_drops_unknown_values() {
        let line = r#"YANK_PROGRESS:{"percent":42.5,"speed":"1048576.0","eta":"NA"}"#;
        assert_eq!(
            parse_line(line),
            Line::Progress(Progress {
                percent: 42.5,
                speed: Some("1048576.0".into()),
                eta: None,
            })
        );
    }

    #[test]
    fn a_missing_percent_counts_as_zero() {
        let line = r#"YANK_PROGRESS:{"percent":null,"speed":"None","eta":"3"}"#;
        let Line::Progress(progress) = parse_line(line) else { panic!() };
        assert_eq!((progress.percent, progress.speed, progress.eta), (0.0, None, Some("3".into())));
    }

    #[test]
    fn parses_the_final_path_with_spaces_and_brackets() {
        assert_eq!(
            parse_line("YANK_FILE:/Users/me/Movies/Yank/Me at the zoo [jNQXAC9IVRw].mp4"),
            Line::File("/Users/me/Movies/Yank/Me at the zoo [jNQXAC9IVRw].mp4".into())
        );
    }

    #[test]
    fn everything_else_is_ignored() {
        assert_eq!(parse_line("[download] Destination: x.mp4"), Line::Other);
        assert_eq!(parse_line("YANK_PROGRESS:not json"), Line::Other);
        assert_eq!(parse_line("YANK_FILE:   "), Line::Other);
    }

    #[test]
    fn only_transient_failures_are_retried() {
        assert!(is_transient_failure("ERROR: unable to download video data: HTTP Error 403: Forbidden"));
        assert!(is_transient_failure("ERROR: HTTP Error 503: Service Unavailable"));
        assert!(is_transient_failure("ERROR: Connection reset by peer"));
        assert!(!is_transient_failure("ERROR: [youtube] Unsupported URL: https://example.com"));
        assert!(!is_transient_failure("ERROR: HTTP Error 404: Not Found"));
        assert!(!is_transient_failure(""));
    }
}
