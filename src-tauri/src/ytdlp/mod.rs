//! Everything that knows how yt-dlp is invoked and what it prints.
//!
//! - [`toolchain`]: find yt-dlp, ffmpeg and deno on this machine.
//! - [`args`]: build command lines (pure, unit tested).
//! - [`output`]: parse the progress and file lines a download prints.
//! - [`info`]: ask what a URL is (one video or a playlist).
//! - [`qualities`]: what a video can be downloaded as, and at what size.
//! - [`search`]: search YouTube (the YouTube screen).
//! - [`stream`]: the URL to watch a video without downloading it.
//!
//! Running a download and reacting to its result lives in `downloads`.

pub mod args;
pub mod info;
pub mod output;
pub mod qualities;
pub mod search;
pub mod stream;
pub mod toolchain;

pub use toolchain::Toolchain;
