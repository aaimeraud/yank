//! One error type for every command.
//!
//! The frontend only ever sees the `Display` text, so each variant's message
//! is written for the person using the app, not for a developer.

use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    /// A message meant to be shown as-is ("Folder not found.").
    #[error("{0}")]
    User(String),

    /// yt-dlp exited with an error. Holds the tail of its stderr.
    #[error("{0}")]
    YtDlp(String),

    #[error("Database error: {0}")]
    Db(#[from] sqlx::Error),

    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("Could not read yt-dlp output: {0}")]
    Json(#[from] serde_json::Error),
}

impl AppError {
    pub fn user(message: impl Into<String>) -> Self {
        Self::User(message.into())
    }

    /// True when SQLite rejected a write because of a UNIQUE constraint.
    pub fn is_unique_violation(&self) -> bool {
        matches!(self, Self::Db(sqlx::Error::Database(db)) if db.is_unique_violation())
    }
}

/// Tauri sends command errors to JavaScript as JSON; a plain string keeps
/// `catch (e) { String(e) }` readable on the other side.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
