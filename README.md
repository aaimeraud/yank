# Yank

A macOS desktop app for [yt-dlp](https://github.com/yt-dlp/yt-dlp): paste a
video, playlist or channel URL from YouTube, X (Twitter), Twitch or any of the
[sites yt-dlp supports](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md),
and Yank downloads it, files it in a library, and plays it in its own player.

- **Downloads**: single videos and whole playlists/channels, as H.264 MP4
  (plays everywhere), audio-only M4A, or the best original quality. Queue with
  pause, resume, cancel, retry, adjustable concurrency, and automatic retries
  for YouTube's transient 403s. Failures show yt-dlp's error, with the full
  log and a "Copy diagnostics" button.
- **Library**: folders (a playlist gets its own, numbered in playlist order),
  search, filters by source and watch status, sorting, bulk move/delete,
  Show in Finder, Copy link.
- **Player**: tabs, resume where you stopped, watched at 90%, play queue,
  autoplay through a folder, keyboard shortcuts, picture in picture.

## Requirements

Yank runs the tools you install; it does not bundle them yet.

```bash
brew install yt-dlp ffmpeg deno
```

- **yt-dlp** does the downloading. Keep it current (`brew upgrade yt-dlp`):
  when a site changes, a yt-dlp update is almost always the fix.
- **ffmpeg** merges the video and audio streams.
- **deno** solves YouTube's player challenge. Without it many YouTube
  downloads fail with 403 errors.

Yank finds them in `PATH`, `~/.local/bin`, `/opt/homebrew/bin` and
`/usr/local/bin` (an app started from Finder does not get your shell's PATH).
Settings › Tools shows what was found. `YTDLP_PATH=/path/to/yt-dlp` overrides
the yt-dlp lookup.

Private, members-only or age-restricted videos, and most of X, need your
browser cookies: export them as a Netscape `cookies.txt` (for example with the
"Get cookies.txt LOCALLY" extension) and pick the file in Settings.

## Develop

Needs [Rust](https://rustup.rs), [Bun](https://bun.sh) and the tools above.

```bash
bun install
bun run tauri dev      # run the app with hot reload
bun run check          # everything below, in order
```

| Command | What it checks | Time |
| --- | --- | --- |
| `bun test` | Frontend logic in `src/lib/` | < 1 s |
| `bunx tsc --noEmit` | Frontend types, including the IPC client | ~2 s |
| `cargo test` (in `src-tauri/`) | Backend: database, queue, yt-dlp arguments and parsing, retries with a fake yt-dlp | ~4 s |
| `cargo clippy --all-targets` | Rust lints | ~5 s |
| `cargo test -- --ignored` | Live tests against YouTube with your real yt-dlp (network) | ~1 min |

Build a `.app`: `bun run tauri build` (unsigned, personal use).

Data lives in `~/Library/Application Support/com.yank.app/yank.db` (SQLite),
logs in `~/Library/Logs/com.yank.app/yank.log`, downloads in `~/Movies/Yank`
unless you pick another folder.

## Find your way around

Read [docs/architecture.md](docs/architecture.md) first: it follows one URL
from the paste box to a file on disk and names the file for each step.

```
src/                    React UI
  api.ts                every backend call, typed (the only place with command names)
  types.ts              mirrors of the Rust types
  App.tsx               wires the hooks together
  hooks/                state: library, queue, settings, tabs, play queue
  lib/                  pure logic with unit tests (filters, formatting, grouping)
  components/           views
src-tauri/src/          Rust backend
  lib.rs                startup and the list of commands
  commands/             the IPC surface, thin
  downloads/            queue runtime: enqueue, worker, retries, yt-dlp process
  ytdlp/                finding, invoking and parsing yt-dlp
  db/                   SQLite, one file per table
  settings.rs, models.rs
src-tauri/migrations/   schema, applied at startup
docs/adr/               why things are the way they are
GLOSSARY.md             the words the code uses
```
