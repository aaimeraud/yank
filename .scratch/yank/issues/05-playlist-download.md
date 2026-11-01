# 05: Playlist download

**What to build:** Submit a playlist URL; fetch its entries; enqueue all videos; create a Playlist entity grouping them; report partial failures ("12 of 15 downloaded, 3 failed") with retry for failed items.

**Blocked by:** 03

**Status:** ready-for-agent

- [x] Playlist URL detected and entries fetched via yt-dlp
- [x] Playlist entity created with title, source, url, thumbnail
- [x] All entries enqueued; videos linked to playlist
- [ ] Partial failures recorded with reasons; summary shown
- [x] Retry failed items individually
- [ ] Playlists view lists playlists; opening one shows its videos in order

## Comments

2026-11-01: Extraction, playlist upsert, and per-entry queueing are implemented in
`ticket-21-playlist-downloads` and `ticket-23-download-controls`, with a live
extraction test and a `queueEntries` unit test. The Downloads view shows each
item's own status and error, and failed items have a Retry button. Still open:
a single "12 of 15" summary, and a Playlists view grouping videos by playlist.
