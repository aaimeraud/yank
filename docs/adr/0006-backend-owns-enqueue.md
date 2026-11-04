# The backend turns a URL into downloads in one command

The first version did this in the UI: fetch the URL's info, create the playlist, resolve its folder, then call `add_video` and `start_download` once per entry, passing the download folder and format along. A 300-video playlist meant 600 IPC calls, the logic could only be tested with a mocked `invoke`, and a half-finished loop left rows without downloads. `enqueue_url` now does all of it in Rust: `downloads::enqueue::plan` writes every row and returns the jobs, and is unit tested against an in-memory database. The UI sends a URL and an optional format and gets back a summary to show.

Following the same idea, commands no longer take the download folder or format from the UI. The backend reads settings when a download starts, and each queue row remembers the format it was queued with (`queue_items.format`), so resuming or retrying after changing the default never turns a queued video into an audio file.
