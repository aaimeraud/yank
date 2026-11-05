import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import * as Q from "../lib/playerQueue";
import { usePref } from "../lib/prefs";
import type { Video } from "../types";

export type PlayerMode = "full" | "mini";

/**
 * The one player of the app: what is playing, its queue and history (see
 * lib/playerQueue.ts), and how it is shown. It survives every navigation:
 * leaving the player screen shrinks it to the mini player instead of
 * stopping it.
 *
 * Every video is checked on disk right before it starts, because a file can
 * be deleted in Finder while the app runs. A missing one is forgotten, the
 * library reloads, and the next candidate is tried.
 */
export function usePlayer(videos: Video[], onFileMissing: () => Promise<void> | void) {
  const [state, setState] = useState<Q.PlayerState>(Q.EMPTY_PLAYER);
  const stateRef = useRef(state);
  // Every change goes through here and updates stateRef at once, so an
  // async step that follows (another Next) never reads a stale state.
  const commit = useCallback((update: (s: Q.PlayerState) => Q.PlayerState) => {
    const nextState = update(stateRef.current);
    stateRef.current = nextState;
    setState(nextState);
  }, []);

  const [autoplay, setAutoplay] = usePref("autoplay", true);
  const [repeat, setRepeat] = usePref("repeat", false);
  // Bumped each time a video is started on purpose, so the element plays it
  // even when it is the same id (Play again, Previous to the same video).
  const [startToken, setStartToken] = useState(0);

  const byId = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const playable = useCallback((id: string) => !!byIdRef.current.get(id)?.file_path, []);

  // A video removed from the library leaves the player too.
  useEffect(() => {
    const gone = [state.current, ...state.queue, ...state.history, ...(state.context?.ids ?? [])].filter(
      (id): id is string => id !== null && !byId.has(id),
    );
    if (gone.length > 0) commit((current) => Q.forget(current, gone));
  }, [byId, state]);

  /** True when the file is still on disk; forgets the video otherwise. */
  const verify = useCallback(
    async (id: string) => {
      if (!playable(id)) return false;
      const missing = await api.pruneMissingVideos([id]).catch(() => [] as string[]);
      if (missing.length === 0) return true;
      commit((current) => Q.forget(current, missing));
      await onFileMissing();
      return false;
    },
    [playable, onFileMissing],
  );

  const start = useCallback(
    (update: (s: Q.PlayerState) => Q.PlayerState) => {
      commit(update);
      setStartToken((token) => token + 1);
    },
    [commit],
  );

  // Next and Previous wait on a disk check; a second press (or the end of
  // the video) arriving meanwhile is ignored rather than skipping twice.
  const busyRef = useRef(false);
  const exclusive = useCallback(async (step: () => Promise<boolean>) => {
    if (busyRef.current) return false;
    busyRef.current = true;
    try {
      return await step();
    } finally {
      busyRef.current = false;
    }
  }, []);

  const playVideo = useCallback(
    async (video: Video, context?: Q.PlayContext) => {
      if (!(await verify(video.id))) return false;
      start((s) => Q.play(s, video.id, context));
      return true;
    },
    [verify, start],
  );

  /** Move to what comes next, skipping files that vanished. False at the end. */
  const goNext = useCallback(() => exclusive(async () => {
    // Files found missing during this call. stateRef only catches up on the
    // next render, so without this set the loop would retry the same one.
    const missing = new Set<string>();
    const candidate = (id: string) => playable(id) && !missing.has(id);
    for (;;) {
      const target = Q.peekNext(stateRef.current, candidate);
      if (!target) return false;
      if (await verify(target.id)) {
        start((s) => Q.next(s, candidate));
        return true;
      }
      missing.add(target.id);
    }
  }), [playable, verify, start, exclusive]);

  const goPrevious = useCallback(() => exclusive(async () => {
    const { history } = stateRef.current;
    const back = history[history.length - 1];
    if (!back) return false;
    if (!(await verify(back))) return false;
    start(Q.previous);
    return true;
  }), [verify, start, exclusive]);

  /** What the player does when a video reaches its end. */
  const onEnded = useCallback(async () => {
    if (autoplay) await goNext();
  }, [autoplay, goNext]);

  const resolve = useCallback(
    (ids: string[]) => ids.map((id) => byId.get(id)).filter((v): v is Video => !!v),
    [byId],
  );

  return {
    current: state.current ? (byId.get(state.current) ?? null) : null,
    queue: resolve(state.queue),
    upNext: resolve(Q.upNextFromContext(state, playable)),
    /** Most recent first, as the queue panel lists it. */
    history: resolve([...state.history].reverse()),
    contextLabel: state.context?.label ?? null,
    nextVideo: (() => {
      const target = Q.peekNext(state, playable);
      return target ? (byId.get(target.id) ?? null) : null;
    })(),
    canPrevious: state.history.length > 0,
    startToken,
    autoplay,
    setAutoplay,
    repeat,
    setRepeat,
    playVideo,
    goNext,
    goPrevious,
    onEnded,
    enqueue: (video: Video) => commit((s) => Q.enqueue(s, video.id)),
    playNext: (video: Video) => commit((s) => Q.playNext(s, video.id)),
    removeFromQueue: (id: string) => commit((s) => Q.removeFromQueue(s, id)),
    moveInQueue: (id: string, to: number) => commit((s) => Q.moveInQueue(s, id, to)),
    clearQueue: () => commit(Q.clearQueue),
    stop: () => commit(Q.stop),
    forget: (ids: string[]) => commit((s) => Q.forget(s, ids)),
  };
}

export type Player = ReturnType<typeof usePlayer>;
