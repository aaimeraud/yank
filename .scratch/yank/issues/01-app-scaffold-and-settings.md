# 01: App scaffold and settings

**What to build:** A runnable Tauri 2 app (Rust backend + React/Vite/TypeScript/Tailwind UI) that launches, shows an empty Library, persists user settings in SQLite, and lets the user choose a downloads folder. Includes DB migrations and a settings store.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Tauri 2 project builds and runs on macOS
- [ ] SQLite DB created with migrations (settings, videos, playlists, queue)
- [ ] Settings store persists download_dir, default_quality, concurrency, theme
- [ ] Onboarding prompt to pick downloads folder (default ~/Movies/Yank)
- [ ] Empty Library view renders with sidebar navigation (Library, Downloads, Settings)
