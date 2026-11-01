# Yank

A native macOS desktop app that downloads videos and playlists from yt-dlp-supported sources and plays them locally.

## Language

**Video**:
A single downloadable media item identified by a source URL, with metadata (title, uploader, duration) and a local file once downloaded.

**Playlist**:
A named, ordered collection of Videos originating from one source URL, downloaded as a unit but tracked as a group.

**Source**:
The platform a Video or Playlist came from (YouTube, Twitter/X, Twitch, or Other), derived from the URL and overridable.

**Library**:
The set of Videos and Playlists the user has downloaded, persisted locally with metadata and playback state.

**Download Queue**:
The ordered list of pending, in-progress, failed, and completed download jobs, persisted across app restarts.

**Queue Item**:
A single entry in the Download Queue representing one Video's download attempt, with progress, status, and error info.

**Thumbnail**:
A cached image representing a Video or Playlist in the Library UI, fetched during download and stored locally.

**Playback Position**:
The last watched timestamp of a Video, used to offer resume on next play.

**Watched**:
A Video whose playback reached at least 90% completion.

**Cookies File**:
A Netscape-format cookies.txt imported by the user to enable downloads requiring authentication.
