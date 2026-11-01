import { describe, expect, test } from "bun:test";
import type { Metadata, QueueItem, Video } from "../types";
import { queueEntries } from "./queueEntries";

const meta = (id: string, overrides: Partial<Metadata> = {}): Metadata => ({
  id,
  title: `Video ${id}`,
  uploader: "Uploader",
  duration: 60,
  thumbnail: null,
  extractor: "Youtube",
  webpage_url: `https://www.youtube.com/watch?v=${id}`,
  ...overrides,
});

const video = (id: string, overrides: Partial<Video> = {}): Video => ({
  id,
  title: `Video ${id}`,
  uploader: null,
  duration: null,
  thumbnail_path: null,
  source: "Youtube",
  url: `https://www.youtube.com/watch?v=${id}`,
  file_path: null,
  watched: false,
  last_position: 0,
  ...overrides,
});

const queueItem = (videoId: string, status: string): QueueItem => ({
  id: `q-${videoId}-${status}`,
  video_id: videoId,
  status,
  progress: 0,
  speed: null,
  eta: null,
  error: null,
  created_at: 0,
});

function recorder() {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
  const invoke = async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args: args ?? {} });
    return null;
  };
  return { calls, invoke };
}

describe("queueEntries", () => {
  test("queues every playlist entry through its own watch url", async () => {
    const { calls, invoke } = recorder();
    const metas = [meta("a"), meta("b"), meta("c")];

    const queued = await queueEntries(
      { metas, playlistId: "p1", downloadDir: "/tmp/yank", formatPref: "video", videos: [], queue: [] },
      invoke,
    );

    expect(queued).toBe(3);
    const adds = calls.filter((c) => c.cmd === "add_video");
    const starts = calls.filter((c) => c.cmd === "start_download");
    expect(adds).toHaveLength(3);
    expect(starts).toHaveLength(3);

    for (const [i, m] of metas.entries()) {
      const added = adds[i].args.video as Record<string, unknown>;
      expect(added.url).toBe(m.webpage_url);
      expect(added.id).toBe(m.id);
      expect(added.playlist_id).toBe("p1");
      expect(added.source).toBe("Youtube");
      expect(starts[i].args).toMatchObject({
        videoId: m.id,
        url: m.webpage_url,
        formatPref: "video",
        downloadDir: "/tmp/yank",
      });
    }
  });

  test("skips downloaded videos and anything already in flight", async () => {
    const { calls, invoke } = recorder();
    const metas = [meta("done"), meta("active"), meta("paused"), meta("fresh")];

    const queued = await queueEntries(
      {
        metas,
        playlistId: "p1",
        downloadDir: "/tmp/yank",
        formatPref: "video",
        videos: [video("done", { file_path: "/tmp/done.mp4" })],
        queue: [queueItem("active", "downloading"), queueItem("paused", "paused")],
      },
      invoke,
    );

    expect(queued).toBe(1);
    expect(calls.map((c) => c.cmd)).toEqual(["add_video", "start_download"]);
    expect((calls[0].args.video as Record<string, unknown>).id).toBe("fresh");
  });

  test("re-queues a finished row that never produced a file", async () => {
    const { calls, invoke } = recorder();

    const queued = await queueEntries(
      {
        metas: [meta("ghost")],
        playlistId: "p1",
        downloadDir: "/tmp/yank",
        formatPref: "video",
        videos: [video("ghost")],
        queue: [queueItem("ghost", "done")],
      },
      invoke,
    );

    expect(queued).toBe(1);
    expect(calls.map((c) => c.cmd)).toEqual(["add_video", "start_download"]);
  });

  test("skips entries yt-dlp could not give a watch url", async () => {
    const { calls, invoke } = recorder();

    const queued = await queueEntries(
      {
        metas: [meta("a", { webpage_url: null })],
        playlistId: null,
        downloadDir: "/tmp/yank",
        formatPref: "video",
        videos: [],
        queue: [],
      },
      invoke,
    );

    expect(queued).toBe(0);
    expect(calls).toEqual([]);
  });

  test("generates an id when yt-dlp does not supply one", async () => {
    const { calls, invoke } = recorder();

    const queued = await queueEntries(
      {
        metas: [meta("", { webpage_url: "https://www.youtube.com/watch?v=unknown" })],
        playlistId: null,
        downloadDir: "/tmp/yank",
        formatPref: "video",
        videos: [],
        queue: [],
      },
      invoke,
      () => "generated-id",
    );

    expect(queued).toBe(1);
    expect((calls[0].args.video as Record<string, unknown>).id).toBe("generated-id");
    expect(calls[1].args.videoId).toBe("generated-id");
  });
});
