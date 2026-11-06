# 03: Single video download (MP4)

**What to build:** Submit a URL, enqueue a download, spawn yt-dlp requesting MP4 (H.264+AAC), stream progress (percent/speed/ETA) to the UI, save the file to the downloads folder, write a library entry with metadata and thumbnail, and show it in the Library.

**Blocked by:** 01, 02

**Status:** done

- [x] URL input creates a queue item and starts download
- [x] yt-dlp spawned with MP4 format selection and `--newline` progress template
- [x] Progress events reach frontend and update the queue item
- [x] File saved under downloads folder using naming template
- [x] Library entry created with title, uploader, duration, thumbnail, source, url, file path
- [x] Failed downloads marked failed with short reason
