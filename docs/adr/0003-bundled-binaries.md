# Bundle yt-dlp and ffmpeg with the app

**Status: superseded by [ADR 0005](0005-find-tools-like-a-finder-launched-app.md).**
Yank does not bundle the tools today; it runs the user's own installs. Bundling
and auto-updating yt-dlp remain wanted for later.

To work out of the box on a clean Mac, Yank ships its own yt-dlp and ffmpeg binaries rather than depending on the user installing them. yt-dlp is auto-updated from GitHub releases on launch; ffmpeg is pinned to a known-good version and updated only with app releases. System binaries are used as a fallback when present and newer.
