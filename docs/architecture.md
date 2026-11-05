# Architecture

Yank is a Tauri 2 app (ADR 0001): a Rust process that owns the database and
runs yt-dlp, and a React UI in a WKWebView that talks to it through `invoke`
commands and one event.

```
┌──────────── React (src/) ────────────┐        ┌──────────── Rust (src-tauri/src/) ─────────────┐
│ components ─ hooks ─ api.ts ─────────┼─invoke─▶ commands/ ─▶ downloads::DownloadManager      │
│                         ▲            │        │                 ├─ enqueue  (URL → rows, jobs)  │
│                         └────────────┼─event──┤                 ├─ worker   (row → done/failed) │
│                       download-progress       │                 └─ process  (one yt-dlp run)    │
└──────────────────────────────────────┘        │            ytdlp/  (find, args, parse)          │
                                                │            db/     (SQLite, one file per table)  │
                                                └─────────────────────────────────────────────────┘
```

## One URL, end to end

1. **Paste.** `components/Sidebar.tsx` checks it looks like an http(s) URL
   (`lib/enqueue.ts`) and calls `api.enqueueUrl(url, format)`.
2. **What is it?** `commands/downloads.rs::enqueue_url` →
   `DownloadManager::enqueue_url` runs
   `yt-dlp --dump-single-json --flat-playlist URL` (`ytdlp/info.rs`). The JSON
   becomes a `UrlInfo`: one entry for a video, many for a playlist or channel.
3. **Plan.** `downloads/enqueue.rs::plan` does all database work and nothing
   else, so it is tested without yt-dlp:
   - a playlist gets a `playlists` row (reused by URL) and a library folder
     named after it; videos already in the library are linked and renumbered;
   - each entry gets a `videos` row (matched by id or URL, so re-adding never
     duplicates) unless it is already downloaded or already in the queue;
   - each entry to download gets a `queue_items` row in status `queued`,
     with the chosen format.
4. **Wait for a slot.** Each new row gets a worker task
   (`downloads/worker.rs::run`). It waits on the concurrency gate
   (`downloads/gate.rs`), a semaphore whose size Settings can change live.
5. **Download.** `downloads/process.rs` runs yt-dlp with the arguments from
   `ytdlp/args.rs`. Two machine-readable lines come back on stdout
   (`ytdlp/output.rs`): `YANK_PROGRESS:{json}` many times, `YANK_FILE:/path`
   once at the end. yt-dlp runs in its own process group so pause and cancel
   stop ffmpeg too. Progress goes to the UI as a `download-progress` event and
   to the database about once a second.
6. **Decide.** After the process exits the worker re-reads the row and
   `worker::decide` picks one of: finished, retry (transient error, up to 3
   attempts, ADR 0004), failed, or interrupted (the user paused, cancelled or
   removed it meanwhile).
7. **Done.** `db/videos.rs::set_downloaded` stores the path, size and
   thumbnail. The UI hears `done`, reloads the library, and the card becomes
   playable.

## Who owns the truth

- **The queue row's status** is what the user wants. Pause and cancel write
  the status, then kill the process. The worker never keeps its own state; it
  reads the row after every run and every backoff. That is why a pause during
  a retry backoff, or a resume while the old process is still exiting, both
  land correctly (tests in `downloads/tests.rs`).
- **Claims** (`DownloadManager::claim`) make sure one row has at most one
  worker. A resume that arrives while a worker still holds the claim is
  picked up by that worker, which looks at the row once more after releasing
  its claim.
- **Settings** are read at the start of each download, so a new folder or
  cookies file applies to the next download without a restart.

## Frontend

- `api.ts` is the only file with command names. `types.ts` mirrors
  `models.rs`; change both together.
- `hooks/` hold state. `useLibrary` owns videos, folders and the
  folder/search/filter/sort query; `useDownloads` owns the queue and applies
  progress events; `useTabs` and `usePlayQueue` drive the player.
- `lib/` is pure logic with tests: what the grid shows (`libraryView.ts`,
  `libraryFilter.ts`), how the queue is grouped (`queueGroups.ts`), number
  formatting, source mapping, toasts (`notify.ts`).
- Errors from any command surface as a toast (`lib/notify.ts`); nothing
  calls `window.alert`. Confirmations use the native dialog (`lib/confirm.ts`).

## The player

There is one player for the whole window (`components/player/Player.tsx`).
It stays mounted while something plays; the screen you are on only decides
its frame: the full player screen, or the mini player in the corner when you
go back to the library. The stage holding the `<video>` is always its first
child, so React keeps the same element and playback never restarts.

What plays next follows Spotify's model, in `lib/playerQueue.ts` (pure,
tested): the history, the current video, "Next in your queue" (Play next /
Add to queue), then "Next from <folder>", the list playback was started
from. `hooks/usePlayer.ts` holds that state, checks each file on disk right
before it starts, and skips files that vanished. `player/usePlayback.ts`
owns the element: it resumes where you stopped and saves the position every
5 seconds and when the video changes.

## Startup (`lib.rs::start_backend`)

1. Open `~/Library/Application Support/com.yank.app/yank.db` and run
   migrations.
2. Downloads that were running when the app quit become `paused`.
3. Library rows whose file disappeared lose their file path (the card then
   offers Download).
4. Find yt-dlp, ffmpeg and deno (`ytdlp/toolchain.rs`, ADR 0005).

## Where it could break

- **yt-dlp changes its JSON or print fields.** `ytdlp/info.rs` reads a handful
  of fields with fallbacks; `ytdlp/output.rs` only depends on templates we
  pass. The ignored live tests catch this: run `cargo test -- --ignored`
  after a yt-dlp update.
- **A site needs login.** The download fails with yt-dlp's message
  ("Sign in to confirm your age"); the fix is a cookies file.
- **Progress jumps back to 0** once per video download: yt-dlp fetches the
  video stream, then the audio stream, and reports each from 0 to 100.
- **Stopping a download** (pause, cancel, quitting the app) sends SIGTERM to
  yt-dlp's whole process group, ffmpeg included. The `.part` files stay, so
  resume continues where it stopped.
- **Races between the user and the worker** are settled in SQL: every write
  that ends a download (`mark_done`, `mark_failed`) and every resume
  (`requeue`) only applies from the status it expects, so a cancel or retry
  that lands in the last milliseconds wins. The UI replays progress events
  received during a reload on top of the reload's result
  (`lib/queueGroups.ts::replayEvents`).
- **"Move file to Trash"** goes through `disk.rs` (NSFileManager, ADR 0007).
  Unit tests swap the Trash for a temp folder so they never touch yours.
- **A video whose file disappeared** keeps its library entry (watched state,
  folder): `downloaded_at` records that it was downloaded once, and queue
  cleanup only deletes videos that never were.
