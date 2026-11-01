# Yank — v1 Spec

Native macOS desktop app (Tauri 2) for downloading videos/playlists from yt-dlp-supported sources and playing them locally.

## Product decisions

- Platform: macOS first, personal/dev build (unsigned); expand later.
- Name: Yank.
- Sources: YouTube, Twitter/X, Twitch, Other (auto-detect + manual override).
- Scope v1: single videos + full playlists; quality picker (best/1080p/audio-only). No subtitles, no thumbnail embedding into files.
- Auth: import Netscape cookies.txt; no in-app login.

## Architecture

- Tauri 2: Rust backend (subprocesses, SQLite, queue) + React 19/Vite/TS/Tailwind v4 UI.
- State: Zustand stores + React Query; Tauri events for progress.
- DB: sqlx + SQLite, migrations via sqlx migrate.
- Binaries: bundled yt-dlp + ffmpeg; yt-dlp auto-update from GitHub; ffmpeg pinned.
- Progress: yt-dlp `--newline --progress-template` JSON lines -> Rust -> Tauri events.

## Data model

- Playlist: id, title, source, url, thumbnail.
- Video: id, title, uploader, duration, thumbnail_path, source, url, file_path, file_size, downloaded_at, last_position, watched, playlist_id.
- QueueItem: id, video_id, status, progress, speed, eta, error, created_at.
- Settings: download_dir, default_quality, concurrency, cookies_path, theme.

## Library UX

- Views: Playlists, All Videos. Search by title/uploader. Filter by source/status. Sort by date/title/duration.
- Thumbnails cached locally; source-branded placeholder fallback.
- Context menu: Play, Reveal in Finder, Copy URL, Re-download, Remove/Delete.
- Keyboard shortcuts for player. Bulk select with bulk delete/re-download/reveal.
- Deletion: "Remove from library" (keep file) vs "Delete file and entry".
- Resume prompt for videos >60s; watched at 90%.

## Player

- Single window, bottom mini-player expanding to fullscreen.
- Controls: play/pause, seek, volume, fullscreen, queue, resume position.

## Download queue

- Persistent, default concurrency 2, per-item progress/speed/ETA.
- Pause/resume/cancel/retry. Restored on restart.
- Partial playlist failures reported with retry.

## App lifecycle

- Closing window hides to menu bar; downloads continue; badge count.
- Quit from menu bar cancels with confirmation.
- Onboarding: pick folder, bootstrap binaries, optional cookies import. Skippable.

## Diagnostics

- Per-item error badge + stderr tail + "Copy diagnostics".
- Global log: ~/Library/Logs/Yank/.

## Updates

- App via Tauri updater (signed, later). yt-dlp via GitHub releases check. ffmpeg pinned.

## Testing

- Rust unit tests: DB repos, queue, arg builder, progress parser.
- Frontend: Vitest + Testing Library.
- Gate tests <2s where possible.

## Accessibility

- Keyboard nav, ARIA labels, focus rings, reduced-motion, VoiceOver-friendly.
- Full WCAG AA audit deferred to v2.

## Deferred to v2

- Subtitles, thumbnail embedding into files, multi-platform, signed/notarized distribution, WCAG AA audit, metadata refresh, watch history beyond position.
