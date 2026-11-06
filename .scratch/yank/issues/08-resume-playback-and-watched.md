# 08: Resume playback and watched tracking

**What to build:** Store last playback position per video; offer resume for videos longer than 60s; mark as watched after 90% completion. Persist across sessions.

**Blocked by:** 04

**Status:** done

- [x] Last position saved every 5s during playback and when the video changes
- [x] Resume is automatic past 5s (and more than 10s from the end), with a "Resumed at mm:ss · Start over" notice
- [x] Watched flag set at 90% completion
- [x] Position and watched state persist across app restarts

## Comments

- 2026-11-04 (daniel/finish-yank): Resume threshold lowered from 60s to 5s and made non-blocking; no prompt interrupts playback.
