# 02: Binary bootstrap

**What to build:** On first run (and on update), the app ensures yt-dlp and ffmpeg are available: detect bundled/system binaries, download yt-dlp from GitHub releases if missing, show progress, fall back to system binaries when present and newer. Auto-update yt-dlp on launch.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] Detect bundled and system yt-dlp/ffmpeg on startup
- [ ] Download yt-dlp release when missing, with progress UI
- [ ] Store binary paths in settings
- [ ] Auto-check GitHub releases for yt-dlp updates on launch
- [ ] Surface bootstrap errors with retry
