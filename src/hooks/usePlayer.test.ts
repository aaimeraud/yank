// The player hook with a fake backend: the stream session against the
// library's queue, where the bugs the reviews found lived (ADR 0010).
import "../test/dom";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { Stream, Video } from "../types";
import { makeVideo } from "../test/fixtures";
import type { StreamItem } from "../lib/streamSession";

const { fake, streamVideo } = await import("../test/fakeBackend");
const { renderHook, act, waitFor, cleanup } = await import("@testing-library/react");
const { usePlayer } = await import("./usePlayer");

const hls = (name: string): Stream => ({ url: `https://m/${name}.m3u8`, is_hls: true, is_live: false });
const item = (id: string, video: Partial<Video> = {}): StreamItem => ({
  video: makeVideo(id, { file_path: null, ...video }),
  url: `https://www.youtube.com/watch?v=${id}`,
  live: false,
});
async function answer(url: string, stream: Stream) {
  const at = fake.lookups.findIndex((lookup) => lookup.url === url);
  const [lookup] = fake.lookups.splice(at, 1);
  await act(async () => lookup.resolve(stream));
}

const libraryVideos = [makeVideo("lib-a", { file_path: "/m/a.mp4" }), makeVideo("lib-b", { file_path: "/m/b.mp4" })];
function setup(videos = libraryVideos) {
  return renderHook(({ list }) => usePlayer(list, () => {}), { initialProps: { list: videos } });
}

beforeEach(() => {
  fake.reset();
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  fake.reset();
});

describe("a stream session", () => {
  test("opens at once, loads, then plays the resolved stream", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x"), item("y")], 0, "q"));
    expect(result.current.current?.id).toBe("x");
    expect(result.current.source).toMatchObject({ streaming: true, loading: true, src: undefined });
    await answer(item("x").url, hls("x"));
    expect(result.current.source).toMatchObject({ loading: false, src: "https://m/x.m3u8" });
    expect(result.current.nextVideo?.id).toBe("y");
  });

  test("a lookup that answers after the user moved on is dropped", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x"), item("y")], 0, "q"));
    act(() => result.current.streamIndex(1));
    await answer(item("y").url, hls("y"));
    await answer(item("x").url, hls("x"));
    expect(result.current.current?.id).toBe("y");
    expect(result.current.source.src).toBe("https://m/y.m3u8");
  });

  /** Regression: clicking the hit already playing restarted it from 0. */
  test("watching what already plays keeps it playing", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x"), item("y")], 0, "q"));
    await answer(item("x").url, hls("x"));
    const token = result.current.startToken;
    act(() => result.current.playStream([item("w"), item("x"), item("y")], 1, "other"));
    expect(result.current.startToken).toBe(token);
    expect(result.current.source.src).toBe("https://m/x.m3u8");
    expect(result.current.stream?.label).toBe("other");
    expect(streamVideo).toHaveBeenCalledTimes(1);
  });

  /** Regression: the library video playing, then Play all from it, dropped the list. */
  test("a session started on the library video playing adopts the list without restarting", async () => {
    const { result } = setup();
    await act(async () => void (await result.current.playVideo(libraryVideos[0])));
    const token = result.current.startToken;
    act(() => result.current.playStream([item("lib-a", { file_path: "/m/a.mp4" }), item("y")], 0, "playlist"));
    expect(result.current.startToken).toBe(token);
    expect(result.current.current?.id).toBe("lib-a");
    expect(result.current.source.src).toBe("asset:///m/a.mp4");
    expect(result.current.nextVideo?.id).toBe("y");
  });

  /** Regression: "Play next" on the library video played before the session was skipped. */
  test("the user's queue plays before the session, the video played before included", async () => {
    const { result } = setup();
    await act(async () => void (await result.current.playVideo(libraryVideos[0])));
    act(() => result.current.playStream([item("x"), item("y")], 0, "q"));
    await answer(item("x").url, hls("x"));
    act(() => result.current.playNext(libraryVideos[0]));
    expect(result.current.nextVideo?.id).toBe("lib-a");
    await act(async () => void (await result.current.goNext()));
    expect(result.current.current?.id).toBe("lib-a");
    expect(result.current.stream).toBeNull();
    expect(result.current.source).toMatchObject({ streaming: false, src: "asset:///m/a.mp4" });
  });

  /** Regression: after a network change, Previous brought back the dead cached URL. */
  test("a stream that died is looked up afresh when reached again", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x"), item("y")], 0, "q"));
    await answer(item("x").url, hls("x"));
    act(() => result.current.streamFailed(true));
    await act(async () => void (await result.current.goNext()));
    await answer(item("y").url, hls("y"));
    await act(async () => void (await result.current.goPrevious()));
    expect(result.current.source.loading).toBe(true);
    expect(streamVideo).toHaveBeenCalledTimes(3);
  });

  /** Regression: queueing the video on screen made Next replay it from 0. */
  test("the video on screen is never next, even queued", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("lib-a", { file_path: "/m/a.mp4" }), item("y")], 0, "q"));
    await act(async () => {});
    act(() => result.current.enqueue(libraryVideos[0]));
    expect(result.current.nextVideo?.id).toBe("y");
    await act(async () => void (await result.current.goNext()));
    expect(result.current.current?.id).toBe("y");
  });

  /** Regression: Previous to a streamed video started it at 0. */
  test("a position saved during the session is where Previous resumes", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x"), item("y")], 0, "q"));
    await answer(item("x").url, hls("x"));
    act(() => result.current.notePlayback("x", 480, false));
    await act(async () => void (await result.current.goNext()));
    await answer(item("y").url, hls("y"));
    await act(async () => void (await result.current.goPrevious()));
    expect(result.current.current?.id).toBe("x");
    expect(result.current.current?.last_position).toBe(480);
    expect(result.current.source.src).toBe("https://m/x.m3u8"); // from the cache, no new lookup
    expect(streamVideo).toHaveBeenCalledTimes(2);
  });

  /** Regression: Try again after a failed lookup wiped a 20:00 resume point. */
  test("a failed lookup offers a retry that keeps the resume point", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x", { last_position: 1200 })], 0, "q"));
    await act(async () => fake.lookups.shift()!.reject("ERROR: network"));
    expect(result.current.source).toMatchObject({ loading: false, error: "ERROR: network" });
    act(() => result.current.retryStream(0));
    expect(result.current.source.loading).toBe(true);
    expect(result.current.current?.last_position).toBe(1200);
    await answer(item("x").url, hls("x"));
    expect(result.current.source.src).toBe("https://m/x.m3u8");
  });

  /** Regression: clicking a hit whose lookup failed did nothing. */
  test("watching a hit stuck on an error looks it up again", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x")], 0, "q"));
    await act(async () => fake.lookups.shift()!.reject("ERROR: x"));
    act(() => result.current.playStream([item("x")], 0, "q"));
    expect(streamVideo).toHaveBeenCalledTimes(2);
    expect(result.current.source.error).toBeNull();
  });

  /** Regression: after a stall, re-watching the hit reused the dead URL and restarted at 0. */
  test("watching a hit whose stream died looks it up afresh and resumes", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x")], 0, "q"));
    await answer(item("x").url, hls("x"));
    act(() => result.current.notePlayback("x", 300, false));
    act(() => result.current.streamFailed(true));
    act(() => result.current.playStream([item("x")], 0, "q"));
    expect(streamVideo).toHaveBeenCalledTimes(2);
    expect(result.current.current?.last_position).toBe(300);
    await answer(item("x").url, hls("x2"));
    expect(result.current.source.src).toBe("https://m/x2.m3u8");
  });

  test("a stream that recovered by itself is left alone when watched again", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x")], 0, "q"));
    await answer(item("x").url, hls("x"));
    act(() => result.current.streamFailed(true));
    act(() => result.current.streamFailed(false));
    const token = result.current.startToken;
    act(() => result.current.playStream([item("x")], 0, "q"));
    expect(result.current.startToken).toBe(token);
    expect(streamVideo).toHaveBeenCalledTimes(1);
  });

  /** Regression: downloaded while it played, then Previous streamed it instead of the file. */
  test("going back to a video that finished downloading plays its file", async () => {
    const { result, rerender } = setup();
    act(() => result.current.playStream([item("x"), item("y")], 0, "q"));
    await answer(item("x").url, hls("x"));
    rerender({ list: [...libraryVideos, makeVideo("x", { file_path: "/m/x.mp4" })] });
    expect(result.current.source.src).toBe("https://m/x.m3u8"); // the one playing keeps its source
    await act(async () => void (await result.current.goNext()));
    await answer(item("y").url, hls("y"));
    await act(async () => void (await result.current.goPrevious()));
    await act(async () => {});
    expect(result.current.source).toMatchObject({ streaming: false, src: "asset:///m/x.mp4" });
  });

  test("an item whose file vanished streams instead", async () => {
    fake.missingFiles = ["gone"];
    const { result } = setup();
    act(() => result.current.playStream([item("gone", { file_path: "/m/gone.mp4" })], 0, "q"));
    await waitFor(() => expect(streamVideo).toHaveBeenCalledTimes(1));
    expect(result.current.current?.file_path).toBeNull();
    expect(result.current.source.streaming).toBe(true);
  });

  test("an item on disk plays its file without a lookup", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("lib-b", { file_path: "/m/b.mp4" }), item("y")], 0, "q"));
    await act(async () => {});
    expect(result.current.source).toMatchObject({ streaming: false, src: "asset:///m/b.mp4" });
    expect(streamVideo).not.toHaveBeenCalled();
  });

  test("removing the video playing in a session closes the player", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x"), item("y")], 0, "q"));
    act(() => result.current.forget(["x"]));
    expect(result.current.current).toBeNull();
    expect(result.current.stream).toBeNull();
  });

  test("playing from the library ends the session", async () => {
    const { result } = setup();
    act(() => result.current.playStream([item("x")], 0, "q"));
    await act(async () => void (await result.current.playVideo(libraryVideos[1])));
    expect(result.current.stream).toBeNull();
    expect(result.current.current?.id).toBe("lib-b");
  });
});
