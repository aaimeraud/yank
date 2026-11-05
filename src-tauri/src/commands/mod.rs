//! The IPC surface: every function the UI can call through `invoke`.
//!
//! Commands are thin. They unpack arguments, call into `db`, `downloads` or
//! `settings`, and return. The typed client for all of them is `src/api.ts`;
//! keep the two in sync.

pub mod downloads;
pub mod library;
pub mod system;

/// What every command takes to reach the queue, the database and the tools.
type Manager<'a> = tauri::State<'a, crate::downloads::DownloadManager>;
