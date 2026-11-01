# 07: Queue management

**What to build:** Persistent download queue with pause/resume/cancel/retry, configurable concurrency, and restoration of queue state after app restart. Failed items stay in queue until retried.

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] Queue persisted to SQLite; restored on launch
- [ ] Pause/resume/cancel/retry controls per item and globally
- [ ] Concurrency setting respected (default 2)
- [ ] Failed items remain with reason; retry re-runs them
- [ ] Cancelled items removable from queue
