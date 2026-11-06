import { expect, test } from "bun:test";
import { PLAYER_ACTS, createGate, reporting } from "./userActs";

test("a wait stays wanted until the user acts, and a newer wait outdates it", () => {
  const gate = createGate();
  const first = gate.begin();
  expect(first()).toBe(true);
  gate.act();
  expect(first()).toBe(false);
  const second = gate.begin();
  const third = gate.begin();
  expect(second()).toBe(false);
  expect(third()).toBe(true);
});

test("wrapped methods report before they run; others are left alone", () => {
  const calls: string[] = [];
  const target = {
    playStream: (n: number) => (calls.push(`play ${n}`), n * 2),
    onEnded: () => calls.push("ended"),
    label: "x",
  };
  const wrapped = reporting(target, ["playStream"], () => calls.push("act"));
  expect(wrapped.playStream(4)).toBe(8);
  wrapped.onEnded();
  expect(calls).toEqual(["act", "play 4", "ended"]);
  expect(wrapped.label).toBe("x");
});

/**
 * Regression: picking a row of the queue panel did not count, so a slow
 * Play all replaced what the user had just picked. Everything that starts,
 * moves or stops playback counts; autoplay (onEnded) never does.
 */
test("the player acts cover every way the user changes what plays", () => {
  expect<string[]>([...PLAYER_ACTS].sort()).toEqual(
    ["goNext", "goPrevious", "playStream", "playVideo", "retryStream", "stop", "streamIndex"].sort(),
  );
  expect<readonly string[]>(PLAYER_ACTS).not.toContain("onEnded");
});
