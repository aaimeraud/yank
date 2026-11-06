# 05: Playlist download

**What to build:** Submit a playlist URL; fetch its entries; enqueue all videos; create a Playlist entity grouping them; report partial failures ("12 of 15 downloaded, 3 failed") with retry for failed items.

**Blocked by:** 03

**Status:** done

- [x] Playlist URL detected and entries fetched via yt-dlp
- [x] Playlist entity created with title, source, url, thumbnail
- [x] All entries enqueued; videos linked to playlist
- [x] Partial failures recorded with reasons; a "12 of 15 downloaded · 3 failed" summary is shown
- [x] Retry failed items individually and in bulk
- [x] Playlist videos listed in playlist order — a folder named after the playlist replaces a separate Playlists screen

## Comments

2026-11-01: Extraction, playlist upsert, and per-entry queueing are implemented in
`ticket-21-playlist-downloads` and `ticket-23-download-controls`, with a live
extraction test and a `queueEntries` unit test. The Downloads view shows each
item's own status and error, and failed items have a Retry button.

- 2026-11-04 (daniel/finish-yank): Partial failures: Downloads groups rows by playlist with "12 of 15 downloaded · 3 failed" and per-row Retry plus Retry failed (N). Folders cover the separate Playlists screen.
