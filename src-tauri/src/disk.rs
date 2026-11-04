//! Removing files the user asked to delete.
//!
//! "Delete file" moves the video and its thumbnail to the macOS Trash, so a
//! wrong click can be undone from Finder. See ADR 0007 for why the
//! NSFileManager method is used instead of asking Finder.

use std::io;
use std::path::Path;

/// Move one file to the Trash. A file that is already gone counts as done.
pub fn move_to_trash(path: &Path) -> io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    trash_impl(path)
}

#[cfg(all(target_os = "macos", not(test)))]
fn trash_impl(path: &Path) -> io::Result<()> {
    use trash::macos::{DeleteMethod, TrashContextExtMacos};
    let mut context = trash::TrashContext::default();
    // Finder (the crate's default) drives Finder through AppleScript, which
    // makes macOS ask an unsigned app for Automation permission and fails
    // if the user says no. NSFileManager needs no permission.
    context.set_delete_method(DeleteMethod::NsFileManager);
    context.delete(path).map_err(io::Error::other)
}

#[cfg(all(not(target_os = "macos"), not(test)))]
fn trash_impl(path: &Path) -> io::Result<()> {
    trash::delete(path).map_err(io::Error::other)
}

/// Unit tests must not fill the developer's real Trash. They get a stand-in
/// that moves the file into `test_trash_dir()`, so they can assert both that
/// the file left its folder and that it was kept, not destroyed.
#[cfg(test)]
fn trash_impl(path: &Path) -> io::Result<()> {
    let bin = test_trash_dir();
    std::fs::create_dir_all(&bin)?;
    let name = format!("{}-{}", uuid::Uuid::new_v4(), path.file_name().unwrap().to_string_lossy());
    std::fs::rename(path, bin.join(name))
}

#[cfg(test)]
pub fn test_trash_dir() -> std::path::PathBuf {
    std::env::temp_dir().join("yank-test-trash")
}

/// True when a file with this name sits in the test Trash.
#[cfg(test)]
pub fn in_test_trash(file_name: &str) -> bool {
    std::fs::read_dir(test_trash_dir())
        .map(|entries| {
            entries
                .flatten()
                .any(|entry| entry.file_name().to_string_lossy().ends_with(file_name))
        })
        .unwrap_or(false)
}

/// Delete this test's files from the test Trash, so runs do not pile up.
#[cfg(test)]
pub fn empty_test_trash(file_name: &str) {
    if let Ok(entries) = std::fs::read_dir(test_trash_dir()) {
        for entry in entries.flatten() {
            if entry.file_name().to_string_lossy().ends_with(file_name) {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::fixtures::temp_dir;

    #[test]
    fn a_missing_file_is_not_an_error() {
        assert!(move_to_trash(Path::new("/definitely/not/here.mp4")).is_ok());
    }

    #[test]
    fn the_file_leaves_its_folder_but_is_kept() {
        let dir = temp_dir("trash");
        let name = format!("{}.mp4", uuid::Uuid::new_v4());
        let file = dir.join(&name);
        std::fs::write(&file, b"x").unwrap();
        move_to_trash(&file).unwrap();
        assert!(!file.exists());
        assert!(in_test_trash(&name));
        empty_test_trash(&name);
        assert!(!in_test_trash(&name));
        let _ = std::fs::remove_dir_all(dir);
    }
}
