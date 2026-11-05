// What plays, what played, and what plays next. Spotify's model:
//
//   Previously played   history, most recent last
//   Now playing         current
//   Next in queue       queue, what the user added by hand ("Play next",
//                       "Add to queue"); always comes first
//   Next from <label>   context, the list the video was started from (a
//                       folder as it was shown), continued after `cursor`
//
// Pure functions over ids. The caller decides what is playable (a file on
// disk) with the `playable` predicate, so a vanished file is skipped instead
// of stalling autoplay. hooks/usePlayer.ts holds the state.

export interface PlayContext {
  /** Shown as "Next from <label>": the folder or view it was started from. */
  label: string;
  ids: string[];
}

export interface PlayerState {
  current: string | null;
  history: string[];
  queue: string[];
  context: PlayContext | null;
  /** Index in context.ids of the context item played last; -1 before any. */
  cursor: number;
}

export const EMPTY_PLAYER: PlayerState = { current: null, history: [], queue: [], context: null, cursor: -1 };

/** Older history is dropped; nobody pages back through 200 videos. */
export const HISTORY_LIMIT = 50;

type Playable = (id: string) => boolean;

function pushHistory(history: string[], id: string | null): string[] {
  if (!id) return history;
  return [...history.filter((past) => past !== id), id].slice(-HISTORY_LIMIT);
}

/** Make `id` the current video. Passing a context replaces the old one. */
export function play(state: PlayerState, id: string, context?: PlayContext): PlayerState {
  const nextContext = context ?? state.context;
  const index = nextContext ? nextContext.ids.indexOf(id) : -1;
  return {
    current: id,
    // The history never holds the video that is playing now.
    history: (id === state.current ? state.history : pushHistory(state.history, state.current)).filter((past) => past !== id),
    queue: state.queue.filter((queued) => queued !== id),
    context: nextContext,
    cursor: index !== -1 ? index : context ? -1 : state.cursor,
  };
}

/** The id `next` would move to, without moving. */
export function peekNext(state: PlayerState, playable: Playable): { id: string; from: "queue" | "context"; index: number } | null {
  const queued = state.queue.find((id) => id !== state.current && playable(id));
  if (queued) return { id: queued, from: "queue", index: state.queue.indexOf(queued) };
  if (!state.context) return null;
  for (let i = state.cursor + 1; i < state.context.ids.length; i += 1) {
    const id = state.context.ids[i];
    if (id !== state.current && playable(id)) return { id, from: "context", index: i };
  }
  return null;
}

/**
 * Move to what comes next. Entries ahead of it in the queue that cannot play
 * are dropped on the way, so they do not stall the next call either.
 * Returns the state unchanged when there is nothing left (autoplay stops).
 */
export function next(state: PlayerState, playable: Playable): PlayerState {
  const target = peekNext(state, playable);
  if (!target) {
    return { ...state, queue: state.queue.filter((id) => id !== state.current && playable(id)) };
  }
  if (target.from === "queue") {
    return {
      ...state,
      current: target.id,
      history: pushHistory(state.history, state.current).filter((past) => past !== target.id),
      queue: state.queue.slice(target.index + 1),
    };
  }
  return {
    ...state,
    current: target.id,
    history: pushHistory(state.history, state.current).filter((past) => past !== target.id),
    queue: state.queue.filter((id) => playable(id)),
    cursor: target.index,
  };
}

/**
 * Go back to the video played before. If the one being left came from the
 * queue (not the context), it returns to the front of the queue, so Next
 * brings it back as Spotify does. Unchanged when there is no history.
 */
export function previous(state: PlayerState): PlayerState {
  const back = state.history[state.history.length - 1];
  if (!back) return state;
  const inContext = state.context ? state.context.ids.indexOf(back) : -1;
  const leaving = state.current;
  const leavingInContext = leaving !== null && state.context?.ids.includes(leaving);
  return {
    ...state,
    current: back,
    history: state.history.slice(0, -1),
    queue: leaving && !leavingInContext ? [leaving, ...state.queue.filter((id) => id !== leaving)] : state.queue,
    cursor: inContext !== -1 ? inContext : state.cursor,
  };
}

/** Add to the end of "Next in queue"; adding twice does not queue twice. */
export function enqueue(state: PlayerState, id: string): PlayerState {
  return state.queue.includes(id) ? state : { ...state, queue: [...state.queue, id] };
}

/** Put at the front of "Next in queue", moving it if already queued. */
export function playNext(state: PlayerState, id: string): PlayerState {
  return { ...state, queue: [id, ...state.queue.filter((queued) => queued !== id)] };
}

export function removeFromQueue(state: PlayerState, id: string): PlayerState {
  return { ...state, queue: state.queue.filter((queued) => queued !== id) };
}

/** Move a queued id to `to` (0-based, clamped). */
export function moveInQueue(state: PlayerState, id: string, to: number): PlayerState {
  const rest = state.queue.filter((queued) => queued !== id);
  if (rest.length === state.queue.length) return state;
  const at = Math.max(0, Math.min(to, rest.length));
  return { ...state, queue: [...rest.slice(0, at), id, ...rest.slice(at)] };
}

export function clearQueue(state: PlayerState): PlayerState {
  return { ...state, queue: [] };
}

/** Stop playback. History and queue stay, so Previous and Next still work. */
export function stop(state: PlayerState): PlayerState {
  return { ...state, current: null, history: pushHistory(state.history, state.current) };
}

/** Forget videos that left the library or lost their file. */
export function forget(state: PlayerState, ids: Iterable<string>): PlayerState {
  const gone = new Set(ids);
  if (gone.size === 0) return state;
  const keep = (id: string) => !gone.has(id);
  const context = state.context ? { ...state.context, ids: state.context.ids.filter(keep) } : null;
  return {
    current: state.current && gone.has(state.current) ? null : state.current,
    history: state.history.filter(keep),
    queue: state.queue.filter(keep),
    context,
    // Same item, or the last kept one before it, in the shortened list.
    cursor: state.context && state.cursor >= 0 ? state.context.ids.slice(0, state.cursor + 1).filter(keep).length - 1 : -1,
  };
}

/** What the queue panel lists under "Next from <label>": context items still ahead. */
export function upNextFromContext(state: PlayerState, playable: Playable, limit = 30): string[] {
  if (!state.context) return [];
  const queued = new Set(state.queue);
  return state.context.ids
    .slice(state.cursor + 1)
    .filter((id) => id !== state.current && !queued.has(id) && playable(id))
    .slice(0, limit);
}
