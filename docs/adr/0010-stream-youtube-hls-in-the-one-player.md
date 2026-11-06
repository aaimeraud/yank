# Watching before downloading: YouTube's HLS stream in the one player

The YouTube screen lets you watch a search result without downloading it. Three ways to play a YouTube video in the app were considered:

- **The YouTube embed (`<iframe>`).** In a packaged Tauri app the page origin is `tauri://localhost`, and YouTube's embedded player refuses to start without a web Referer (error 153). It would also be a second player with its own controls, queue and keyboard, next to ours.
- **A progressive MP4 (format 18) in our `<video>`.** It answers 403 to any request that is not yt-dlp's own (checked with curl on 2026-11-05), and tops out at 360p.
- **The HLS master playlist in our `<video>`.** YouTube serves its iOS and visionOS clients an HLS playlist: H.264 + AAC at every bitrate, plus captions. yt-dlp finds it (`-f "bv*[protocol^=m3u8]" --print %(manifest_url)s`, about 4 s with the JS challenge solved by deno), and WKWebView plays HLS natively, adaptive bitrate and seeking included. Checked in a real WKWebView: playback starts within a second of `play()` and ramps from 256 px to 1920 px wide in four seconds.

We stream the HLS playlist into the app's one player (ADR 0008). A stream is a *stream session* (`lib/streamSession.ts`, held by `hooks/usePlayer.ts`): the hits it was started from, in order, so Next and autoplay go through the search results or the playlist. The user's own queue still comes first: "Play next" means next, and playing a queued video ends the session. Playing anything from the library ends it too. A hit already downloaded plays its file instead of streaming.

While a stream resolves the `<video>` is unloaded (`pause`, drop `src`, `load()`): removing the `src` attribute alone does not stop a media element, so the previous video would keep playing under the new title and save its position under the new id.

The URL is resolved right before playing and never stored: it carries the machine's IP and expires after about six hours. A resolved URL is reused for an hour so Previous is instant; an expired or dropped stream shows "Try again", which resolves again and resumes at the same second. Live streams play (their duration is infinite, so there is no seek bar or resume) but are not downloaded from this screen, since yt-dlp would record until the stream ends: the UI hides Download for them, `enqueue_url(from_search)` refuses a live or upcoming video whatever the search listing said, and a playlist download leaves its live and upcoming entries out. A live link pasted in the top bar is still recorded: that one is a choice.

Search goes through yt-dlp too, reading YouTube's own results page with its type filter, so it needs no API key and uses the same cookies and toolchain as downloads.
