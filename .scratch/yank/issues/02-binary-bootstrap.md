# 02: Binary bootstrap

**What to build:** On first run (and on update), the app ensures yt-dlp and ffmpeg are available: detect bundled/system binaries, download yt-dlp from GitHub releases if missing, show progress, fall back to system binaries when present and newer. Auto-update yt-dlp on launch.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] Detect system yt-dlp/ffmpeg/deno at startup, outside the Finder PATH (ADR 0005)
- [x] Resolve absolute paths once and pass them to every yt-dlp call
- [ ] Bundle yt-dlp and ffmpeg with the app (ADR 0003, superseded for now)
- [ ] Download yt-dlp release when missing, with progress UI
- [ ] Auto-check GitHub releases for yt-dlp updates on launch
- [ ] Surface bootstrap errors with retry

## Comments

- 2026-11-04 (daniel/finish-yank): Uses the user's own yt-dlp/ffmpeg/deno, found outside PATH (ADR 0005); Settings › Tools shows them with install hints. Downloading, bundling and auto-updating yt-dlp is still open.
