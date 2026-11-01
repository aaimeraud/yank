# 05: Playlist download

**What to build:** Submit a playlist URL; fetch its entries; enqueue all videos; create a Playlist entity grouping them; report partial failures ("12 of 15 downloaded, 3 failed") with retry for failed items.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Playlist URL detected and entries fetched via yt-dlp
- [ ] Playlist entity created with title, source, url, thumbnail
- [ ] All entries enqueued; videos linked to playlist
- [ ] Partial failures recorded with reasons; summary shown
- [ ] Retry failed items individually
- [ ] Playlists view lists playlists; opening one shows its videos in order
