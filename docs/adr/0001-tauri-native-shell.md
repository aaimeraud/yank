# Use Tauri 2 as the native shell with a React frontend

Yank is a desktop app that must feel native on macOS while leveraging web frontend tooling and the design skill. We chose Tauri 2 (Rust backend + React 19/Vite/TypeScript UI rendered in WKWebView, styled with plain CSS and design tokens) over Electron (heavier bundle, more memory) and pure native (SwiftUI, slower iteration, no reuse of frontend design workflow). Rust handles yt-dlp/ffmpeg subprocesses, the SQLite library, and the download queue; the web layer handles UI.
