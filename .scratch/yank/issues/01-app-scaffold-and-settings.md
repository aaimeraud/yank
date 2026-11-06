# 01: App scaffold and settings

**What to build:** A runnable Tauri 2 app (Rust backend + React/Vite/TypeScript UI) that launches, shows an empty Library, persists user settings in SQLite, and lets the user choose a downloads folder. Includes DB migrations and a settings store.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] Tauri 2 project builds and runs on macOS
- [x] SQLite DB created with migrations (settings, videos, playlists, queue)
- [x] Settings store persists download_dir, default_quality and concurrency
- [x] Downloads default to `~/Movies/Yank`, so first launch works without an onboarding prompt
- [x] Empty Library view renders with sidebar navigation (Library, YouTube, Downloads, Settings)
- [ ] Theme setting — dropped: the UI is dark only by design (`src/App.css`)

## Comments

- 2026-11-04 (daniel/finish-yank): No Tailwind, no state library; hooks plus plain CSS. `theme` was dropped with the dark-only direction, and the onboarding prompt with the default folder.
