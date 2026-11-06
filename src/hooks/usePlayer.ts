import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { api } from "../api";
import { errorMessage } from "../lib/notify";
import * as Q from "../lib/playerQueue";
import { usePref } from "../lib/prefs";
import * as S from "../lib/streamSession";
import { isFresh } from "../lib/youtube";
import type { Stream, Video } from "../types";

export type PlayerMode = "full" | "mini";

export type { PlayerSource, StreamItem } from "../lib/streamSession";

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

  // The stream session (lib/streamSession.ts). Set through setSessionNow so
  // the ref is current at once, like `commit` above.
  const [session, setSessionState] = useState<S.StreamSession | null>(null);
  const sessionRef = useRef(session);
  const setSession = useCallback((update: S.StreamSession | null | ((s: S.StreamSession | null) => S.StreamSession | null)) => {
    const next = typeof update === "function" ? update(sessionRef.current) : update;
    sessionRef.current = next;
    setSessionState(next);
  }, []);
  const [resolved, setResolved] = useState<S.Resolved | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const streamErrorRef = useRef(streamError);
  streamErrorRef.current = streamError;
  // The element gave up on the current stream (expired, stalled); set by
  // the player, reset by every start. Re-watching it then looks it up again.
  const elementFailed = useRef(false);
  // Resolved streams by page URL, reused while fresh: Previous, or the same
  // hit clicked twice, then starts at once instead of after ~4 s.
  const cache = useRef(new Map<string, { stream: Stream; at: number }>());
  // Bumped by every stream start; a resolution that finishes after the user
  // moved on is dropped.
  const resolveToken = useRef(0);

  const byId = useMemo(() => new Map(videos.map((video) => [video.id, video])), [videos]);
  const byIdRef = useRef(byId);
  byIdRef.current = byId;
  const playable = useCallback((id: string) => !!byIdRef.current.get(id)?.file_path, []);

  // A session's other items follow the library (downloads finishing).
  useEffect(() => {
    setSession((current) => current && S.syncFromLibrary(current, byId));
  }, [byId, setSession]);

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

  const endSession = useCallback(() => {
    resolveToken.current += 1;
    setSession(null);
    setResolved(null);
    setStreamError(null);
  }, [setSession]);

  const playVideo = useCallback(
    async (video: Video, context?: Q.PlayContext) => {
      if (!(await verify(video.id))) return false;
      endSession();
      start((s) => Q.play(s, video.id, context));
      return true;
    },
    [verify, start, endSession],
  );

  /**
   * Make `next` the session and start its current item: the file when it
   * is still on disk, otherwise a stream (from the cache while fresh;
   * `fresh` forces a new one, for a retry). Every call takes a token, and
   * anything that finishes after a newer call is dropped.
   */
  const streamAt = useCallback(
    async (moving: S.StreamSession, fresh = false) => {
      // The item being moved to may have finished downloading meanwhile.
      const next = S.syncFromLibrary(moving, byIdRef.current, true);
      const token = ++resolveToken.current;
      elementFailed.current = false;
      setSession(next);
      setStreamError(null);
      setResolved(null);
      setStartToken((value) => value + 1);
      // The library video that played before leaves "now playing" (to its
      // history), or the queue would skip it as the current one (peekNext).
      if (stateRef.current.current !== null) commit(Q.stop);
      let item = S.currentItem(next);
      if (!item) return false;
      if (item.video.file_path) {
        const missing = await api.pruneMissingVideos([item.video.id]).catch(() => [] as string[]);
        if (token !== resolveToken.current) return false;
        if (missing.length === 0) return true;
        // Deleted in Finder since it was listed: stream it instead. From the
        // session as it is now, so a position saved meanwhile is kept.
        setSession((current) => current && S.forgetFiles(current, missing));
        item = S.currentItem(sessionRef.current)!;
        void onFileMissing();
      }
      const cached = cache.current.get(item.url);
      if (!fresh && cached && isFresh(cached.at, Date.now())) {
        setResolved({ url: item.url, stream: cached.stream });
        return true;
      }
      try {
        const stream = await api.streamVideo(item.url);
        cache.current.set(item.url, { stream, at: Date.now() });
        if (token === resolveToken.current) setResolved({ url: item.url, stream });
        return true;
      } catch (error) {
        if (token === resolveToken.current) setStreamError(errorMessage(error));
        return false;
      }
    },
    [setSession, onFileMissing, commit],
  );

  /**
   * Stream `items[index]`, the rest of `items` becoming what plays next.
   * The player opens at once and shows the poster while yt-dlp resolves.
   * When that video is already the one playing, only the list is replaced:
   * it keeps playing where it is.
   */
  const playStream = useCallback(
    (items: S.StreamItem[], index: number, label: string) => {
      const target = items[index];
      if (!target) return;
      const streaming = S.currentItem(sessionRef.current);
      const playingId = streaming?.video.id ?? stateRef.current.current;
      // Already playing (and not stuck on an error): adopt the new list,
      // leave the video alone. Same video and source, so it plays on.
      const adopted = { items: items.map((item, i) => (i === index && streaming ? streaming : item)), index, label };
      if (playingId === target.video.id) {
        if (streaming && (streamErrorRef.current || elementFailed.current)) {
          // Stuck: a fresh lookup (the cached URL may be the dead one),
          // resuming where it was last saved.
          cache.current.delete(streaming.url);
          void streamAt(S.resumeAt(adopted, S.retryPosition(streaming, 0)), true);
          return;
        }
        setSession(adopted);
        if (stateRef.current.current !== null) commit(Q.stop);
        return;
      }
      void streamAt({ items, index, label });
    },
    [streamAt, setSession, commit],
  );

  /** Try the current stream again, from `position` seconds (it expired, or failed). */
  const retryStream = useCallback(
    (position: number) => {
      const current = sessionRef.current;
      const item = S.currentItem(current);
      if (!current || !item) return;
      cache.current.delete(item.url);
      void streamAt(S.resumeAt(current, S.retryPosition(item, position)), true);
    },
    [streamAt],
  );

  /**
   * Move to what comes next, skipping files that vanished. False at the
   * end. The user's queue comes first, also during a stream session (which
   * that ends); then the session's next item, or the library's context.
   */
  const goNext = useCallback(() => exclusive(async () => {
    // Files found missing during this call. stateRef only catches up on the
    // next render, so without this set the loop would retry the same one.
    const missing = new Set<string>();
    const streaming = sessionRef.current;
    // The video on screen is never "next", also when it plays inside a
    // session (where the library's own current is empty).
    const onScreen = S.currentItem(streaming)?.video.id ?? null;
    const candidate = (id: string) => playable(id) && !missing.has(id) && id !== onScreen;
    // Changes when a stream starts or the session ends; not when a save
    // patches the session (which replaces its object every 5 s).
    const epoch = resolveToken.current;
    for (;;) {
      // Something newer started while a file was being checked: it wins.
      if (resolveToken.current !== epoch) return false;
      const target = Q.peekNext(stateRef.current, candidate);
      if (streaming) {
        const step = S.nextStep(streaming, target?.from === "queue" ? target.id : null);
        if (!step) return false;
        if (step.from === "session") {
          void streamAt(S.moveTo(streaming, step.index)!);
          return true;
        }
      }
      if (!target) return false;
      if (await verify(target.id)) {
        // A stream started meanwhile wins over this older press.
        if (resolveToken.current !== epoch) return false;
        if (streaming) endSession();
        start((s) => Q.next(s, candidate));
        return true;
      }
      missing.add(target.id);
    }
  }), [playable, verify, start, exclusive, streamAt, endSession]);

  const goPrevious = useCallback(() => exclusive(async () => {
    const streaming = sessionRef.current;
    if (streaming) {
      const index = S.previousIndex(streaming);
      if (index === null) return false;
      void streamAt(S.moveTo(streaming, index)!);
      return true;
    }
    const { history } = stateRef.current;
    const back = history[history.length - 1];
    if (!back) return false;
    const epoch = resolveToken.current;
    if (!(await verify(back))) return false;
    if (resolveToken.current !== epoch) return false;
    start(Q.previous);
    return true;
  }), [verify, start, exclusive, streamAt]);

  /** What the player does when a video reaches its end. */
  const onEnded = useCallback(async () => {
    if (autoplay) await goNext();
  }, [autoplay, goNext]);

  const resolve = useCallback(
    (ids: string[]) => ids.map((id) => byId.get(id)).filter((v): v is Video => !!v),
    [byId],
  );

  const libraryCurrent = state.current ? (byId.get(state.current) ?? null) : null;
  const streamItem = S.currentItem(session);
  const current = streamItem?.video ?? libraryCurrent;
  const source: S.PlayerSource = streamItem
    ? S.sessionSource(streamItem, resolved, streamError, convertFileSrc)
    : {
        src: libraryCurrent?.file_path ? convertFileSrc(libraryCurrent.file_path) : undefined,
        streaming: false,
        loading: false,
        error: null,
        isLive: false,
      };
  const libraryNext = Q.peekNext(state, (id) => playable(id) && id !== streamItem?.video.id);
  const sessionNext = session ? S.nextStep(session, libraryNext?.from === "queue" ? libraryNext.id : null) : null;

  return {
    current,
    source,
    /** The open stream session: its items and where it is, for the queue panel. */
    stream: session ? { items: session.items, index: session.index, label: session.label } : null,
    queue: resolve(state.queue),
    upNext: resolve(Q.upNextFromContext(state, playable)),
    /** Most recent first, as the queue panel lists it. */
    history: resolve([...state.history].reverse()),
    contextLabel: state.context?.label ?? null,
    nextVideo: (() => {
      if (session && sessionNext?.from === "session") return session.items[sessionNext.index].video;
      // In a session only the user's queue can come first; else the library's own next.
      if (session && sessionNext?.from !== "queue") return null;
      return libraryNext ? (byId.get(libraryNext.id) ?? null) : null;
    })(),
    canPrevious: session ? session.index > 0 : state.history.length > 0,
    startToken,
    autoplay,
    setAutoplay,
    repeat,
    setRepeat,
    playVideo,
    playStream,
    retryStream,
    /** Jump to another item of the open stream session. */
    streamIndex: (index: number) => {
      const moved = sessionRef.current && S.moveTo(sessionRef.current, index);
      if (moved) void streamAt(moved);
    },
    /** The element gave up on the current stream (true), or recovered (false). */
    streamFailed: (failed: boolean) => {
      elementFailed.current = failed;
      // A dead URL (expired, or the network changed: they are bound to the
      // IP) must not come back from the cache on Previous.
      const item = S.currentItem(sessionRef.current);
      if (failed && item) cache.current.delete(item.url);
    },
    /** A position was saved: the session's copy of that video follows. */
    notePlayback: (id: string, position: number, watched: boolean) =>
      setSession((current) => current && S.patchPlayback(current, id, position, watched)),
    goNext,
    goPrevious,
    onEnded,
    enqueue: (video: Video) => commit((s) => Q.enqueue(s, video.id)),
    playNext: (video: Video) => commit((s) => Q.playNext(s, video.id)),
    removeFromQueue: (id: string) => commit((s) => Q.removeFromQueue(s, id)),
    moveInQueue: (id: string, to: number) => commit((s) => Q.moveInQueue(s, id, to)),
    clearQueue: () => commit(Q.clearQueue),
    stop: () => {
      endSession();
      commit(Q.stop);
    },
    /**
     * These videos left the library. Removing the one playing stops the
     * player, as it does outside a session; other session items stream.
     */
    forget: (ids: string[]) => {
      const playing = S.currentItem(sessionRef.current);
      if (playing && ids.includes(playing.video.id)) {
        // Not back to the library's previous video: the player closes.
        endSession();
        commit((s) => Q.stop(Q.forget(s, ids)));
        return;
      }
      setSession((current) => current && S.forgetFiles(current, ids));
      commit((s) => Q.forget(s, ids));
    },
  };
}

export type Player = ReturnType<typeof usePlayer>;
