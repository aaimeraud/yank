# 09: Diagnostics and logs

**What to build:** Per-item error badge with short reason and expandable stderr tail, "Copy diagnostics" button, and a global log file at ~/Library/Logs/Yank/. Context menu and bulk actions (delete/re-download/reveal) plus keyboard shortcuts.

**Blocked by:** 03

**Status:** ready-for-agent

- [x] Error badge and expandable details with yt-dlp stderr tail
- [x] "Copy diagnostics" copies relevant info to clipboard
- [x] Global log file written under `~/Library/Logs/com.yank.app/yank.log`
- [x] Right-click context menu: Play next, Add to queue, Show in Finder, Copy link, Move, Remove, Delete
- [x] Keyboard shortcuts for play/pause, seek, volume, mute, fullscreen, queue, mini player, next/previous
- [x] Bulk select with bulk move, remove and delete, and a selection count
- [ ] Re-download action for an existing video (today: Delete, then Download again)

## Comments

- 2026-11-04 (daniel/finish-yank): Error headline + expandable stderr tail + Copy diagnostics; log at ~/Library/Logs/com.yank.app/yank.log (Settings › Tools › Logs). Context menu has Play next, Add to queue, Show in Finder, Copy link, Move, Remove, Delete; right-click opens it. Re-download is still open.
