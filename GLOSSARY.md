# Yank

A native macOS desktop app that downloads videos and playlists from yt-dlp-supported sources and plays them locally.

## Language

**Video**:
A single downloadable media item identified by a source URL, with metadata (title, uploader, duration) and a local file once downloaded.

**Playlist**:
A named, ordered collection of Videos originating from one source URL, downloaded as a unit but tracked as a group.

**Source**:
The yt-dlp extractor a Video came from ("youtube", "twitter", "twitch:vod"...). The UI groups sources into YouTube, X, Twitch and Other (`src/lib/source.ts`).

**Library**:
The set of Videos and Playlists the user has downloaded, persisted locally with metadata and playback state.

**Download Queue**:
The ordered list of pending, in-progress, failed, and completed download jobs, persisted across app restarts.

**Queue Item**:
A single entry in the Download Queue representing one Video's download attempt, with progress, status, the Format it was queued with, and error info. Its status (queued, downloading, paused, done, failed, cancelled) is the source of truth for what the user wants.

**Format**:
What yt-dlp is asked for: Video (H.264 MP4, plays in-app), Audio (M4A), or Original (best available, may need an external player).

**Folder**:
A user-made group of Videos in the Library. A Playlist download creates one named after the Playlist, and files land in a directory of the same name.

**Toolchain**:
The external programs Yank runs: yt-dlp, ffmpeg and deno, found at startup.

**Worker**:
The task that takes one Queue Item from queued to done or failed, retrying transient errors.

**Thumbnail**:
A cached image representing a Video or Playlist in the Library UI, fetched during download and stored locally.

**Playback Position**:
The last watched timestamp of a Video, used to offer resume on next play.

**Watched**:
A Video whose playback reached at least 90% completion.

**Play Queue**:
What the player plays next: the user's own queue first, then the rest of the Context. In memory only. Not the Download Queue.

**Context**:
The list of Videos playback was started from (a folder, as it was shown). Autoplay continues through it and the queue panel lists it as "Next from <folder>".

**Mini player**:
The player shrunk to the corner while another screen is open. Same video element, so playback continues.

**Search Result** (hit):
A video or playlist found on the YouTube screen. Not in the Library until downloaded; a video hit has the same id as its Library Video, which is how the screen marks hits already downloaded.

**Stream**:
Watching a Video without downloading it: yt-dlp resolves YouTube's HLS playlist and the player plays it (ADR 0010). The URL expires after a few hours and is never stored.

**Stream Session**:
The list of Search Results a stream was started from (the results, or a playlist). While it is open, Next and autoplay go through it; playing from the Library ends it. Not the Play Queue, which waits untouched.

**Cookies File**:
A Netscape-format cookies.txt imported by the user to enable downloads requiring authentication.
