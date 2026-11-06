<p align="center">
  <img src="docs/assets/icon-light.png" width="128" height="128" alt="Yank's app icon in light mode: a white script y on a pink tile">
  &nbsp;&nbsp;
  <img src="docs/assets/icon-dark.png" width="128" height="128" alt="Yank's app icon in dark mode: a pink script y on a near-black tile">
</p>

<p align="center"><sub>Default and dark, made in Icon Composer. Like Apple's apps, the Dock icon follows the icon style chosen in System Settings › Appearance › Icon &amp; widget style.</sub></p>

# Yank

🇬🇧 English · [🇫🇷 Français](README.fr.md)

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
  Show in Finder, Copy link. Deleting a file moves it to the Trash.
- **YouTube**: search videos and playlists from the sidebar, watch a result
  right away (streamed in the player, up to 1080p, no download needed), or
  download it in any format. A playlist opens with its videos, Play all and
  Download all.
- **Player**: resume where you stopped, watched at 90%, a play queue,
  autoplay through a folder, keyboard shortcuts, picture in picture.

## Install

Download the `.dmg` for your Mac (Apple Silicon `aarch64`, Intel `x64`) from
[Releases](https://github.com/aaimeraud/yank/releases), drag Yank to
Applications, and install the tools below.

Yank is not notarized by Apple, so the first launch is blocked. Open it once,
dismiss the warning, then go to System Settings › Privacy & Security and click
**Open Anyway** next to "Yank was blocked" (right-click › Open no longer works
on recent macOS). Or, in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Yank.app
```

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

For design work, `bun run dev` and open http://localhost:1420 in any browser:
outside Tauri the UI runs on a fake backend with sample data
(`src/dev/browserPreview.ts`, development only). The visual direction is
recorded in `.taste-skill/app/direction.json` and summed up at the top of
`src/App.css`.

| Command | What it checks | Time |
| --- | --- | --- |
| `bun test` | Frontend logic in `src/lib/` | < 1 s |
| `bunx tsc --noEmit` | Frontend types, including the IPC client | ~2 s |
| `cargo test` (in `src-tauri/`) | Backend: database, queue, yt-dlp arguments and parsing, retries with a fake yt-dlp | ~4 s |
| `cargo clippy --all-targets` | Rust lints | ~5 s |
| `cargo test -- --ignored` | Live tests against YouTube with your real yt-dlp (network) | ~1 min |

Build a `.app`: `bun run tauri build` (unsigned, personal use). Needs Xcode 26
or later: the app icon is an Icon Composer file compiled at bundle time
([ADR 0009](docs/adr/0009-brand-icon-and-faces.md)). Cutting a
release: [docs/releasing.md](docs/releasing.md).

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
  hooks/                state: library, downloads, settings, player/queue, YouTube
  lib/                  pure logic with unit tests (filters, formatting, grouping)
  components/           views (youtube/ is the YouTube screen)
src-tauri/src/          Rust backend
  lib.rs                startup and the list of commands
  commands/             the IPC surface, thin
  downloads/            queue runtime: enqueue, worker, retries, yt-dlp process
  ytdlp/                finding, invoking and parsing yt-dlp; YouTube search and streams
  db/                   SQLite, one file per table
  settings.rs, models.rs
src-tauri/migrations/   schema, applied at startup
docs/adr/               why things are the way they are
scripts/release.py      version bump + changelog (run with uv)
GLOSSARY.md             the words the code uses
```

## License

[MIT](LICENSE). Changes per version: [CHANGELOG.md](CHANGELOG.md).
