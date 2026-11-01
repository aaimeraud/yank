# Bundle yt-dlp and ffmpeg with the app

To work out of the box on a clean Mac, Yank ships its own yt-dlp and ffmpeg binaries rather than depending on the user installing them. yt-dlp is auto-updated from GitHub releases on launch; ffmpeg is pinned to a known-good version and updated only with app releases. System binaries are used as a fallback when present and newer.
