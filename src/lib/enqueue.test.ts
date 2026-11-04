import { describe, expect, test } from "bun:test";
import { enqueueMessage, looksLikeUrl } from "./enqueue";

describe("enqueueMessage", () => {
  test("single videos", () => {
    expect(enqueueMessage({ title: "Zoo", is_playlist: false, queued: 1, skipped: 0 })).toBe('Downloading "Zoo".');
    expect(enqueueMessage({ title: "Zoo", is_playlist: false, queued: 0, skipped: 1 })).toBe(
      '"Zoo" is already in the library or the queue.',
    );
  });
  test("playlists", () => {
    expect(enqueueMessage({ title: "Talks", is_playlist: true, queued: 12, skipped: 3 })).toBe(
      'Queued 12 videos from "Talks" (3 already there).',
    );
    expect(enqueueMessage({ title: "Talks", is_playlist: true, queued: 1, skipped: 0 })).toBe(
      'Queued 1 video from "Talks".',
    );
    expect(enqueueMessage({ title: "Talks", is_playlist: true, queued: 0, skipped: 5 })).toBe(
      'Everything in "Talks" is already downloaded or queued.',
    );
  });
});

describe("looksLikeUrl", () => {
  test("accepts web URLs from the main platforms", () => {
    expect(looksLikeUrl("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe(true);
    expect(looksLikeUrl("  https://x.com/NASA/status/1  ")).toBe(true);
    expect(looksLikeUrl("http://www.twitch.tv/videos/123")).toBe(true);
  });
  test("rejects what yt-dlp would reject", () => {
    expect(looksLikeUrl("")).toBe(false);
    expect(looksLikeUrl("youtube.com/watch?v=x")).toBe(false);
    expect(looksLikeUrl("file:///etc/passwd")).toBe(false);
    expect(looksLikeUrl("--exec rm")).toBe(false);
  });
});
