# Yank — v1 spec (living)

Native macOS desktop app built on Tauri 2: paste a URL supported by yt-dlp,
download it into a local library, and play it in the app. This file says what
v1 is and what it is not, as built. The moving parts live in
[`docs/architecture.md`](../../docs/architecture.md) and the decisions in
[`docs/adr/`](../../docs/adr/); the remaining work is in
[`issues/`](issues/).

Last verified against the code: 2026-11-06.

## Product

- **Platform.** macOS, unsigned/ad-hoc-signed personal build (ADR 0001,
  `docs/releasing.md`). Apple Silicon and Intel.
- **Sources.** Anything yt-dlp supports; the UI groups them as YouTube, X,
  Twitch and Other (`src/lib/source.ts`).
- **Scope.** Single videos, whole playlists and channels, three formats,
  in-app streaming of YouTube search results, a persistent download queue, a
  library of folders, and one player with a play queue.
- **Not in v1.** Subtitles, thumbnail embedding, signed/notarized builds,
  a second platform, watch history beyond the last position, WCAG AA audit.

## Architecture as built

- **Shell.** Tauri 2: a Rust process owns SQLite and runs yt-dlp; a React 19
  UI renders in WKWebView and talks to Rust through `invoke` commands plus one
  event, `download-progress`.
- **Frontend.** Vite + TypeScript, plain CSS with tokens (`src/App.css`); no
  Tailwind, no state library, no data-fetching library. State lives in hooks
  (`useLibrary`, `useDownloads`, `usePlayer`, `useSettings`, `useYoutube`,
  `useTabs`); pure logic lives in `src/lib/` with unit tests.
- **Backend.** `sqlx` + SQLite, migrations applied at startup, `tokio` tasks
  for the queue. One file per table under `src-tauri/src/db/`.
- **Toolchain.** Yank runs the user's own `yt-dlp`, `ffmpeg` and `deno`,
  resolved at startup from PATH plus the usual install locations and passed
  explicitly to yt-dlp (ADR 0005). It does not bundle or auto-update them yet
  (ADR 0003 is superseded).
- **IPC contract.** `src/api.ts` holds every command name; `src/types.ts`
  mirrors `src-tauri/src/models.rs`. Change both together.

## Data model

Five migrations under `src-tauri/migrations/`.

- **settings** — key/value. Known keys: `download_dir`, `default_quality`
  (the format; the name predates `Format`), `concurrency` (1–4, default 2),
  `cookies_path`. Unknown keys are rejected.
- **folders** — `id`, unique case-insensitive `name`, `created_at`. A playlist
  download creates one named after the playlist.
- **playlists** — `id`, `title`, `source`, unique `url`, `thumbnail_path`.
  Written by enqueue, never sent to the UI on its own.
- **videos** — `id`, `title`, `uploader`, `duration`, `thumbnail_path`,
  `source`, unique `url`, `file_path`, `file_size`, `downloaded_at`,
  `last_position`, `watched`, `playlist_id`, `folder_id`, `playlist_index`
  (1-based; the card derives "01." from it). A row exists as soon as a
  download is queued; `file_path` appears when the file lands.
- **queue_items** — `id`, `video_id`, `status`, `progress`, `speed`, `eta`,
  `error`, `created_at`, `format`. Status is one of `queued`, `downloading`,
  `paused`, `done`, `failed`, `cancelled`; `format` is the format the row was
  queued with, so changing the default never changes a queued download.

## Download pipeline

1. A URL is pasted in the top bar (`lib/enqueue.ts` validates it looks like
   http(s)) or a search hit is downloaded. `api.enqueueUrl` →
   `commands/downloads.rs::enqueue_url`.
2. `DownloadManager::enqueue_url` runs
   `yt-dlp --dump-single-json --flat-playlist` (`ytdlp/info.rs`) and turns the
   answer into a `UrlInfo`: one entry for a video, many for a playlist or
   channel.
3. `downloads/enqueue.rs::plan` does all database work: upsert the playlist;
   reuse or create a folder named after it; match each entry by id or URL so
   re-adding never duplicates; skip entries already downloaded or queued;
   insert one `queue_items` row per entry to fetch.
4. Each row gets a worker (`downloads/worker.rs::run`) that waits on the
   concurrency semaphore (`downloads/gate.rs`), whose size Settings can change
   live.
5. `downloads/process.rs` runs yt-dlp (`ytdlp/args.rs`) in its own process
   group, so pause and cancel also stop ffmpeg. Two machine-readable stdout
   lines come back (`ytdlp/output.rs`): `YANK_PROGRESS:{json}` repeatedly and
   `YANK_FILE:/path` once. Progress goes to the UI as an event and to SQLite
   about once a second.
6. After the process exits the worker re-reads the row and
   `worker::decide` picks finished, retry (transient error, up to 3 attempts,
   ADR 0004), failed, or interrupted.
7. `db/videos.rs::set_downloaded` stores path, size and thumbnail; the UI
   reloads the library and the card becomes playable.

Formats (ADR 0002): **Video** = H.264 + AAC MP4, plays in app; **Audio** =
M4A/MP3; **Original** = yt-dlp's best, may be WebM/MKV the in-app player
cannot open. Files land in `download_dir`, in a subfolder named after the
playlist folder when there is one, named
`%(title).150B [%(id)s].%(ext)s`; a standalone video uses
`%(channel,uploader|Unknown)s/`.

Private or age-gated media needs a Netscape `cookies.txt` chosen in Settings.
A failure stores the tail of yt-dlp's stderr; Settings › Tools opens the log
at `~/Library/Logs/com.yank.app/yank.log`.

## Screens

Four screens plus the player.

- **Library** — sidebar of folders (`All videos`, `Unfiled`, each folder, `New
  folder`) and a card grid. Search is title/channel and accent-insensitive;
  filters by source and status (`unwatched`, `watched`, `missing`); sort by
  date, title, duration or playlist order. A playlist folder shows videos in
  playlist order with their number. Right-click (or the card's menu button)
  opens: Play next, Add to queue, Show in Finder, Copy link, Move to folder,
  Remove from library, Delete file. Bulk selection supports move, remove and
  delete. Delete moves the file to the Trash (ADR 0007); Remove keeps it.
- **YouTube** — search videos or playlists, 24 per page, next page until
  exhausted. A slow answer never overwrites a newer query (`searchReducer`
  numbers every request). Hits are marked in library / downloading / neither.
  A hit plays by streaming it; a playlist hit opens in place with Play all and
  Download all. Live and upcoming videos can be watched but not downloaded
  from this screen.
- **Downloads** — the queue grouped by playlist and by status, with per-row
  progress, speed, ETA and error tail, Retry, Copy diagnostics; Pause all,
  Resume all, Retry failed, Clear finished.
- **Settings** — download folder, default format, concurrent downloads,
  cookies file; Tools shows the resolved yt-dlp/ffmpeg/deno paths, install
  hints and the log folder.
- **Player** — one player for the window (ADR 0008): a full screen, or a mini
  player in the corner while you browse. Play queue, autoplay through the
  folder playback started from, picture in picture.

## Player

- Resume is automatic from the saved position for any video longer than 5 s
  and more than 10 s from the end, with a "Resumed at mm:ss · Start over"
  notice (not a blocking prompt).
- The position is saved every 5 s and when the video changes; a video counts
  as **watched** at 90% (`lib/playback.ts`). Both survive restarts.
- A missing file is skipped before it starts; a downloaded stream falls back
  to its file.
- Streams (ADR 0010) come from YouTube's HLS master playlist, resolved just
  before playing, never stored, reused for an hour. An expired stream offers
  Try again and resumes at the same second. Live streams have no seek bar and
  no resume.
- Keys on the player screen: Space/K play-pause, ←/J and →/L seek 10 s, ↑/↓
  volume, M mute, F fullscreen, Q queue, I mini player, N/P next/previous.

## Lifecycle and data

- Downloads default to `~/Movies/Yank`, created on first use; the first
  download works without any onboarding.
- The database is `~/Library/Application Support/com.yank.app/yank.db`.
  At startup: interrupted downloads become `paused`, library rows whose file
  vanished lose `file_path`, and the toolchain is resolved.
- Closing the window has no special handling: there is no menu-bar mode,
  background badge or quit confirmation yet.
- The UI is dark only. There is no theme setting; the direction lives in
  `.taste-skill/app/direction.json` and at the top of `src/App.css`.

## Testing

- `bun test` — frontend logic and hook tests (happy-dom for the hooks), with a
  fake backend in `src/test/fakeBackend.ts`.
- `bunx tsc --noEmit` — frontend types, including the IPC client.
- `cargo test` (in `src-tauri/`) — database, queue, yt-dlp arguments and
  output parsing, retries against a fake yt-dlp, search fixtures.
- `cargo clippy --all-targets -- -D warnings` — Rust lints.
- `cargo test -- --ignored` — live YouTube tests (network, about a minute):
  run after a yt-dlp update to catch changed output.
- `bun run check` runs the first four in order. CI runs it on every push to
  `main` and every pull request (`.github/workflows/ci.yml`).

## Remaining work

Tracked as tickets `ready-for-agent` in [`issues/`](issues/):

- **01** — the app, migrations, settings and library ship; no first-run
  onboarding, and `theme` is not a setting (the UI is dark by design).
- **02** — finding the user's tools ships (ADR 0005); downloading and
  auto-updating yt-dlp does not.
- **05** — extraction, folders, per-entry queueing and the "12 of 15"
  summary ship; there is no separate Playlists screen (folders replace it).
- **06** — source detection, chips and placeholder logos ship; there is no
  manual source override.
- **09** — diagnostics, logs, context menu, shortcuts and bulk actions ship;
  there is no "Re-download" action (delete and download again).
- **10** — deletion semantics ship; onboarding, menu-bar mode and the quit
  confirmation do not.

Tickets 03, 04, 07 and 08 are done.

## Deferred to v2

Subtitles, thumbnail embedding into files, metadata refresh, watch history
beyond the last position, a second platform, signed/notarized distribution,
menu-bar background mode, a full WCAG AA audit.
