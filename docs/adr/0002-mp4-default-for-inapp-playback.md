# Default video downloads to MP4 (H.264 + AAC) for in-app playback

WKWebView on macOS plays MP4 reliably but not MKV/WebM in all cases. To guarantee downloaded videos always play inside Yank, the default format selection requests MP4 (H.264 video + AAC audio) from yt-dlp. An "original/best" option remains available but may fall back to "open in external player". Audio-only downloads use M4A/MP3.
