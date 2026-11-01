# 07: Queue management

**What to build:** Persistent download queue with pause/resume/cancel/retry, configurable concurrency, and restoration of queue state after app restart. Failed items stay in queue until retried.

**Blocked by:** 03

**Status:** ready-for-agent

- [x] Queue persisted to SQLite; restored on launch
- [ ] Pause/resume/cancel/retry controls per item and globally
- [ ] Concurrency setting respected (default 2)
- [x] Failed items remain with reason; retry re-runs them
- [x] Cancelled items removable from queue

## Comments

2026-11-01: Per-item pause, resume, retry, cancel, and remove ship in
`ticket-23-download-controls`. Interrupted rows recover as paused on launch.
Concurrency is capped at 2 in code but not yet a setting, and there are no
global pause/cancel-all controls.
