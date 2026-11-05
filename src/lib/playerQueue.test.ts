import { describe, expect, test } from "bun:test";
import {
  EMPTY_PLAYER,
  enqueue,
  forget,
  moveInQueue,
  next,
  peekNext,
  play,
  playNext,
  previous,
  stop,
  upNextFromContext,
  type PlayerState,
} from "./playerQueue";

const all = () => true;
const folder = { label: "Systems Design", ids: ["a", "b", "c", "d"] };
const started = (id = "a") => play(EMPTY_PLAYER, id, folder);

describe("play", () => {
  test("starting from a list sets the context and its cursor", () => {
    const state = started("b");
    expect(state).toMatchObject({ current: "b", cursor: 1, history: [] });
    expect(state.context?.label).toBe("Systems Design");
  });

  test("the video being left goes to history, once", () => {
    let state = started("a");
    state = play(state, "c");
    state = play(state, "a");
    expect(state.history).toEqual(["c"]);
    expect(state.cursor).toBe(0);
  });

  test("playing a queued video takes it out of the queue", () => {
    const state = play(enqueue(started(), "x"), "x");
    expect(state.queue).toEqual([]);
    expect(state.cursor).toBe(0); // x is not in the folder: the cursor stays
  });
});

describe("next", () => {
  test("the queue comes before the rest of the folder", () => {
    let state = enqueue(started("a"), "x");
    state = next(state, all);
    expect(state.current).toBe("x");
    state = next(state, all);
    expect(state.current).toBe("b");
    expect(state.history).toEqual(["a", "x"]);
  });

  test("skips videos whose file is gone, in the queue and in the folder", () => {
    const playable = (id: string) => id !== "b" && id !== "gone";
    let state = enqueue(started("a"), "gone");
    state = next(state, playable);
    expect(state.current).toBe("c");
    expect(state.queue).toEqual([]);
  });

  test("stops at the end of the folder instead of wrapping", () => {
    const end = next(started("d"), all);
    expect(end.current).toBe("d");
    expect(peekNext(end, all)).toBeNull();
  });

  test("after a detour through the queue, the folder resumes where it was", () => {
    let state = playNext(started("b"), "x");
    state = next(state, all); // x
    state = next(state, all); // back to the folder: c, not a
    expect(state.current).toBe("c");
  });
});

test("replaying a past video from the queue moves it out of history", () => {
  let state = next(started("a"), all); // a -> b, history [a]
  state = next(enqueue(state, "a"), all);
  expect(state).toMatchObject({ current: "a", history: ["b"] });
});

describe("previous", () => {
  test("walks back through history and Next returns to where it was", () => {
    let state = next(next(started("a"), all), all); // a -> b -> c
    state = previous(state);
    expect(state.current).toBe("b");
    expect(next(state, all).current).toBe("c");
  });

  test("a queued video being left goes back to the front of the queue", () => {
    let state = next(enqueue(started("a"), "x"), all); // now x, from the queue
    state = previous(state);
    expect(state).toMatchObject({ current: "a", queue: ["x"] });
    expect(next(state, all).current).toBe("x");
  });

  test("with no history it changes nothing", () => {
    const state = started();
    expect(previous(state)).toBe(state);
  });
});

describe("queue editing", () => {
  test("enqueue appends once; playNext moves to the front", () => {
    let state = enqueue(enqueue(enqueue(started(), "x"), "y"), "x");
    expect(state.queue).toEqual(["x", "y"]);
    state = playNext(state, "y");
    expect(state.queue).toEqual(["y", "x"]);
  });

  test("moveInQueue reorders and clamps", () => {
    let state: PlayerState = { ...started(), queue: ["x", "y", "z"] };
    state = moveInQueue(state, "z", 0);
    expect(state.queue).toEqual(["z", "x", "y"]);
    expect(moveInQueue(state, "z", 99).queue).toEqual(["x", "y", "z"]);
    expect(moveInQueue(state, "missing", 0)).toBe(state);
  });
});

test("stop keeps history and the queue", () => {
  const state = stop(enqueue(started("a"), "x"));
  expect(state).toMatchObject({ current: null, history: ["a"], queue: ["x"] });
});

describe("forget", () => {
  test("removes videos everywhere and keeps the cursor on the same item", () => {
    let state = next(started("a"), all); // current b, cursor 1
    state = enqueue(state, "a");
    state = forget(state, ["a"]);
    expect(state.queue).toEqual([]);
    expect(state.history).toEqual([]);
    expect(state.context?.ids).toEqual(["b", "c", "d"]);
    expect(state.cursor).toBe(0);
    expect(next(state, all).current).toBe("c");
  });

  test("forgetting the current video stops it", () => {
    expect(forget(started("a"), ["a"]).current).toBeNull();
  });
});

test("upNextFromContext lists what the folder still holds, minus the queue", () => {
  const state = enqueue(started("a"), "c");
  expect(upNextFromContext(state, all)).toEqual(["b", "d"]);
  expect(upNextFromContext(state, (id) => id !== "d", 1)).toEqual(["b"]);
});
