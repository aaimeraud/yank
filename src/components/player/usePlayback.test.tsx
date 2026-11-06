// usePlayback against a real <video> element (happy-dom): what the element
// does when the source changes, which a test of the player hook alone
// cannot see (ADR 0010).
import "../../test/dom";
import { afterEach, beforeEach, describe, expect, jest, test } from "bun:test";
import { makeVideo } from "../../test/fixtures";
import type { Video } from "../../types";

const { fake } = await import("../../test/fakeBackend");
const { render, act, cleanup } = await import("@testing-library/react");
const { usePlayback } = await import("./usePlayback");

type Playback = ReturnType<typeof usePlayback>;
let playback: Playback;
const saved: [string, number][] = [];

function Harness({ video, src, token = 0 }: { video: Video; src: string | undefined; token?: number }) {
  playback = usePlayback(video, src, token, false, () => {}, (id, position) => saved.push([id, position]));
  return <video data-testid="v" ref={playback.videoRef} src={src} />;
}

/** Make the element look like it loaded `duration` seconds of media, and say so. */
function load(el: HTMLVideoElement, duration: number) {
  Object.defineProperty(el, "readyState", { value: 4, configurable: true });
  Object.defineProperty(el, "duration", { value: duration, configurable: true });
  act(() => void el.dispatchEvent(new Event("loadedmetadata")));
}

function playTo(el: HTMLVideoElement, seconds: number) {
  el.currentTime = seconds;
  act(() => void el.dispatchEvent(new Event("timeupdate")));
}

const library = makeVideo("lib", { file_path: "/m/lib.mp4" });
const streamed = makeVideo("hit", { file_path: null, last_position: 0 });

beforeEach(() => {
  fake.reset();
  saved.length = 0;
});
// Explicit: Testing Library only cleans up by itself when it finds a global afterEach.
afterEach(cleanup);

describe("switching to a stream that is still resolving", () => {
  /**
   * Regression: removing `src` does not unload a media element. The old
   * video kept playing under the new title, and its timeupdates were saved
   * under the new video's id.
   */
  test("unloads the previous media and credits nothing to the new video", () => {
    const view = render(<Harness video={library} src="asset:///m/lib.mp4" />);
    const el = view.getByTestId("v") as HTMLVideoElement;
    load(el, 600);
    playTo(el, 42);

    let paused = 0;
    let loaded = 0;
    el.pause = () => void (paused += 1);
    el.load = () => void (loaded += 1);
    view.rerender(<Harness video={streamed} src={undefined} />);

    expect(el.hasAttribute("src")).toBe(false);
    expect(paused).toBeGreaterThan(0);
    expect(loaded).toBe(1);
    // The library video's last position was saved under its own id.
    expect(saved).toContainEqual(["lib", 42]);

    // Late events from the old media change nothing for the new video.
    const before = saved.length;
    playTo(el, 50);
    act(() => void el.dispatchEvent(new Event("ended")));
    expect(saved.length).toBe(before);
    expect(fake.saves.some(([id]) => id === "hit")).toBe(false);
    expect(playback.position).toBe(0);
  });

  test("starts the stream when its URL arrives, resuming where the video stopped", () => {
    const resumable = { ...streamed, last_position: 120 };
    const view = render(<Harness video={resumable} src={undefined} />);
    const el = view.getByTestId("v") as HTMLVideoElement;
    view.rerender(<Harness video={resumable} src="https://m/hit.m3u8" />);
    expect(el.getAttribute("src")).toBe("https://m/hit.m3u8");
    load(el, 600);
    expect(el.currentTime).toBe(120);
    expect(playback.resumedFrom).toBe(120);
    playTo(el, 130);
    expect(playback.position).toBe(130);
    expect(playback.lastTime()).toBe(130);
  });
});

describe("failures", () => {
  test("an error on a real source marks the run failed, a recovery clears it", () => {
    const view = render(<Harness video={streamed} src="https://m/hit.m3u8" />);
    const el = view.getByTestId("v") as HTMLVideoElement;
    act(() => void el.dispatchEvent(new Event("error")));
    expect(playback.failed).toBe(true);
    act(() => void el.dispatchEvent(new Event("playing")));
    expect(playback.failed).toBe(false);
  });

  test("a new source starts unfailed", () => {
    const view = render(<Harness video={streamed} src="https://m/a.m3u8" />);
    const el = view.getByTestId("v") as HTMLVideoElement;
    act(() => void el.dispatchEvent(new Event("error")));
    view.rerender(<Harness video={streamed} src="https://m/b.m3u8" />);
    expect(playback.failed).toBe(false);
  });

  test("a live stream's infinite duration means no seek bar and no resume", () => {
    const live = { ...streamed, last_position: 300 };
    const view = render(<Harness video={live} src="https://m/live.m3u8" />);
    const el = view.getByTestId("v") as HTMLVideoElement;
    load(el, Number.POSITIVE_INFINITY);
    expect(playback.duration).toBe(0);
    expect(playback.resumedFrom).toBeNull();
  });
});

describe("the stall watchdog", () => {
  /** A playing stream stuck on `second`, as an expired URL leaves it. */
  function stuck(second: number) {
    const view = render(<Harness video={streamed} src="https://m/hit.m3u8" />);
    const el = view.getByTestId("v") as HTMLVideoElement;
    load(el, 600);
    Object.defineProperty(el, "paused", { value: false, configurable: true });
    Object.defineProperty(el, "readyState", { value: 2, configurable: true });
    playTo(el, second);
    act(() => void el.dispatchEvent(new Event("waiting")));
    return el;
  }
  const advance = (ms: number) => act(() => void jest.advanceTimersByTime(ms));

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("25 s stuck while playing counts as failed", () => {
    stuck(30);
    advance(24_000);
    expect(playback.failed).toBe(false);
    advance(1_000);
    expect(playback.failed).toBe(true);
  });

  /** Regression: repeated `stalled` events pushed the deadline back forever. */
  test("repeated stalls at the same second do not push the deadline back", () => {
    const el = stuck(30);
    for (let i = 0; i < 5; i += 1) {
      advance(4_000);
      act(() => void el.dispatchEvent(new Event("stalled")));
    }
    advance(5_000);
    expect(playback.failed).toBe(true);
  });

  /** Regression: a seek during a stall disarmed the watchdog for good. */
  test("a seek that never loads is caught from where it waits", () => {
    const el = stuck(30);
    advance(10_000);
    el.currentTime = 200;
    act(() => void el.dispatchEvent(new Event("seeking")));
    advance(24_000);
    expect(playback.failed).toBe(false);
    advance(1_000);
    expect(playback.failed).toBe(true);
  });

  test("progress or a pause disarms it", () => {
    const el = stuck(30);
    advance(10_000);
    playTo(el, 31);
    advance(30_000);
    expect(playback.failed).toBe(false);

    act(() => void el.dispatchEvent(new Event("waiting")));
    Object.defineProperty(el, "paused", { value: true, configurable: true });
    act(() => void el.dispatchEvent(new Event("pause")));
    advance(30_000);
    expect(playback.failed).toBe(false);
  });

  test("local files are never watched", () => {
    const view = render(<Harness video={library} src="asset:///m/lib.mp4" />);
    const el = view.getByTestId("v") as HTMLVideoElement;
    Object.defineProperty(el, "paused", { value: false, configurable: true });
    act(() => void el.dispatchEvent(new Event("waiting")));
    advance(60_000);
    expect(playback.failed).toBe(false);
  });
});
