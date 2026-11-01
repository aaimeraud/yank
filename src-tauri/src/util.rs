pub fn find_ytdlp() -> String {
    if let Ok(p) = std::env::var("YTDLP_PATH") {
        if std::path::Path::new(&p).exists() { return p; }
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        "yt-dlp".to_string(),
        format!("{}/.local/bin/yt-dlp", home),
        "/opt/homebrew/bin/yt-dlp".to_string(),
        "/usr/local/bin/yt-dlp".to_string(),
        "/usr/bin/yt-dlp".to_string(),
    ];
    for c in candidates {
        if std::process::Command::new(&c).arg("--version").output().map(|o| o.status.success()).unwrap_or(false) {
            return c;
        }
    }
    "yt-dlp".to_string()
}

pub fn find_thumbnail(video_path: &str) -> Option<String> {
    let base = std::path::Path::new(video_path).with_extension("");
    for ext in ["jpg", "jpeg", "webp", "png"] {
        let candidate = base.with_extension(ext);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    None
}
