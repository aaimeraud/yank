// Telling what the user did from what the app did by itself, for actions
// that land seconds later (Play all lists its playlist first). Anything the
// user does to what plays in the meantime wins over the late answer;
// autoplay and screen changes do not count.

export interface Gate {
  /** The user changed what plays. */
  act: () => void;
  /** Start waiting; the returned check is true until the user acts. */
  begin: () => () => boolean;
}

export function createGate(): Gate {
  let count = 0;
  return {
    act: () => void (count += 1),
    begin: () => {
      const at = ++count;
      return () => count === at;
    },
  };
}

/** The player methods that change what plays when the user calls them. */
export const PLAYER_ACTS = ["playVideo", "playStream", "streamIndex", "goNext", "goPrevious", "retryStream", "stop"] as const;

/**
 * `target` with each method named in `acts` reporting to the gate first.
 * One wrapper for every caller (App, the queue panel), so no call site can
 * forget it. `onEnded` (autoplay) is never in the list.
 */
export function reporting<T extends object>(target: T, acts: readonly (keyof T)[], act: () => void): T {
  const wrapped = { ...target };
  for (const name of acts) {
    const method = target[name];
    if (typeof method !== "function") continue;
    wrapped[name] = ((...args: unknown[]) => {
      act();
      return (method as (...a: unknown[]) => unknown)(...args);
    }) as T[keyof T];
  }
  return wrapped;
}
