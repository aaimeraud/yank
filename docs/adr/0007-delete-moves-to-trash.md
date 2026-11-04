# Deleting a video's file moves it to the Trash

"Delete file" used to call `remove_file`, which destroys the file at once, and the confirmation said so ("This cannot be undone"). One misclick on a large download was unrecoverable. The video file and its thumbnail now go to the macOS Trash through the `trash` crate (the standard Rust library for this, maintained since 2017), and the UI says "Move file to Trash".

The crate's default macOS method asks Finder through AppleScript. That makes macOS prompt an unsigned app for Automation permission, and deletion fails if the user declines. Yank uses the `NSFileManager` method instead: no prompt, slightly faster, no Finder sound. The trade-off is that Finder's "Put Back" item is missing on some macOS versions (a macOS bug, trash-rs issue 14); the file can still be dragged out of the Trash.

Unit tests replace the Trash with a temp folder (`disk::trash_impl` under `cfg(test)`), so running the suite never fills the developer's Trash. The real path was checked by hand on macOS: the file left its folder and Finder listed it in the Trash.
