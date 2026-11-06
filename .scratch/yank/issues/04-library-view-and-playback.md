# 04: Library view and in-app playback

**What to build:** Library grid/list with thumbnails, search, source/status filters, sort. A player with play/pause, seek, volume, fullscreen, and a persistent bottom mini-player that expands to a fullscreen view. Play queue support for multi-select.

**Blocked by:** 03

**Status:** ready-for-agent

- [x] Library renders downloaded videos with thumbnails and metadata
- [x] Instant search by title/uploader; filter chips by source and status; sort options
- [x] Mini-player persists at bottom and expands to fullscreen player
- [x] Player controls: play/pause, seek ±10s, volume, fullscreen
- [x] Playing a multi-selection builds a temporary queue
- [ ] "Open in external player" fallback for non-playable files (matters for the Original format)

## Comments

- 2026-11-04 (daniel/finish-yank): Search (title/channel, accent-insensitive), source and status filters, sort by date/title/duration/playlist order. Done except the external-player fallback.
