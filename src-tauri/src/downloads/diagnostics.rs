//! The text behind "Copy diagnostics": everything needed to understand a
//! failed download without opening the app, ready to paste in an issue.

use crate::models::{QueueEntry, ToolchainReport};

pub fn report(entry: &QueueEntry, tools: &ToolchainReport, app_version: &str) -> String {
    let unknown = || "not found".to_string();
    let lines = [
        format!("Yank {app_version}"),
        format!(
            "yt-dlp {} ({})",
            tools.ytdlp_version.clone().unwrap_or_else(|| "?".into()),
            tools.ytdlp_path.clone().unwrap_or_else(unknown)
        ),
        format!("ffmpeg: {}", tools.ffmpeg_path.clone().unwrap_or_else(unknown)),
        format!("deno: {}", tools.deno_path.clone().unwrap_or_else(unknown)),
        String::new(),
        format!("Title: {}", entry.title),
        format!("URL: {}", entry.url),
        format!("Source: {}", entry.source),
        format!("Format: {}", entry.format.as_deref().unwrap_or("default")),
        format!("Status: {} at {:.0}%", entry.status.as_str(), entry.progress),
        String::new(),
        "yt-dlp stderr (last lines):".to_string(),
        entry.error.clone().unwrap_or_else(|| "(none)".into()),
    ];
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::QueueStatus;

    #[test]
    fn report_names_versions_url_and_error() {
        let entry = QueueEntry {
            id: "q1".into(),
            video_id: "v1".into(),
            status: QueueStatus::Failed,
            progress: 12.4,
            speed: None,
            eta: None,
            error: Some("ERROR: HTTP Error 403: Forbidden".into()),
            created_at: 0,
            format: Some("video".into()),
            title: "Me at the zoo".into(),
            url: "https://www.youtube.com/watch?v=jNQXAC9IVRw".into(),
            source: "youtube".into(),
            playlist_id: None,
            playlist_title: None,
            playlist_index: None,
        };
        let tools = ToolchainReport {
            ytdlp_path: Some("/opt/homebrew/bin/yt-dlp".into()),
            ytdlp_version: Some("2026.10.26".into()),
            ffmpeg_path: None,
            deno_path: Some("/opt/homebrew/bin/deno".into()),
        };
        let text = report(&entry, &tools, "0.2.0");
        assert!(text.starts_with("Yank 0.2.0\nyt-dlp 2026.10.26 (/opt/homebrew/bin/yt-dlp)"));
        assert!(text.contains("ffmpeg: not found"));
        assert!(text.contains("Status: failed at 12%"));
        assert!(text.ends_with("ERROR: HTTP Error 403: Forbidden"));
    }
}
