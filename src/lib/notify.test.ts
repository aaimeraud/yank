import { describe, expect, test } from "bun:test";
import { createNotifier, errorMessage, TOAST_MS } from "./notify";

/** A notifier whose timers we fire by hand. */
function manual() {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const notifier = createNotifier((fn, ms) => timers.push({ fn, ms }));
  return { notifier, timers };
}

describe("notifier", () => {
  test("publishes pushes and auto-dismisses after the kind's delay", () => {
    const { notifier, timers } = manual();
    const seen: number[] = [];
    notifier.subscribe((toasts) => seen.push(toasts.length));

    notifier.info("Queued");
    notifier.error("Boom");
    expect(notifier.current().map((t) => t.kind)).toEqual(["info", "error"]);
    expect(timers.map((t) => t.ms)).toEqual([TOAST_MS.info, TOAST_MS.error]);

    timers[0].fn();
    expect(notifier.current().map((t) => t.message)).toEqual(["Boom"]);
    expect(seen).toEqual([1, 2, 1]);
  });

  test("keeps at most four, dropping the oldest", () => {
    const { notifier } = manual();
    for (let i = 1; i <= 6; i += 1) notifier.error(`e${i}`);
    expect(notifier.current().map((t) => t.message)).toEqual(["e3", "e4", "e5", "e6"]);
  });

  test("dismissing twice or after unsubscribe is harmless", () => {
    const { notifier } = manual();
    let calls = 0;
    const stop = notifier.subscribe(() => (calls += 1));
    const id = notifier.info("x");
    notifier.dismiss(id);
    notifier.dismiss(id);
    stop();
    notifier.info("y");
    expect(calls).toBe(2);
  });
});

test("errorMessage reads strings, errors and anything else", () => {
  expect(errorMessage("Folder not found.")).toBe("Folder not found.");
  expect(errorMessage(new Error("nope"))).toBe("nope");
  expect(errorMessage(42)).toBe("42");
});
