# 07: Queue management

**What to build:** Persistent download queue with pause/resume/cancel/retry, configurable concurrency, and restoration of queue state after app restart. Failed items stay in queue until retried.

**Blocked by:** 03

**Status:** done

- [x] Queue persisted to SQLite; restored on launch
- [x] Pause/resume/cancel/retry per item, plus Pause all, Resume all and Retry failed
- [x] Concurrency setting respected (default 2, 1–4, applied live)
- [x] Failed items remain with reason; retry re-runs them
- [x] Cancelled items removable from queue; Clear finished for the rest

## Comments

- 2026-11-01: Per-item pause, resume, retry, cancel, and remove ship in
  `ticket-23-download-controls`. Interrupted rows recover as paused on launch.
- 2026-11-04 (daniel/finish-yank): Pause/resume/cancel/retry per item, Pause all / Resume all / Retry failed, concurrency applied live. Done.
