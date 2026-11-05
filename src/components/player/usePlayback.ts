import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { playbackSnapshot } from "../../lib/playback";
import { readPref, writePref } from "../../lib/prefs";
import type { Video } from "../../types";

/** Save the position every this many seconds of playback. */
const SAVE_EVERY = 5;

/** A stream stuck this long while playing is treated as failed. */
const STALL_LIMIT_MS = 25_000;

const isWeb = (src: string) => /^https?:\/\//.test(src);

/**
 * Everything about the one <video> element: start each new video (resuming
 * where it stopped), keep its position saved, and expose the controls.
 *
 * `startToken` changes whenever the user starts a video on purpose. A new id
 * loads and plays; the same id restarts from the beginning (Play again).
 *
 * `src` is part of what identifies a run: a stream's URL arrives seconds
 * after its video became current, and must start it then (ADR 0010).
 */
export function usePlayback(
  video: Video,
  src: string | undefined,
  startToken: number,
  repeat: boolean,
  onEnded: () => void,
  /** Told about every saved position, so the library's copy stays current. */
  onSaved: (videoId: string, position: number, watched: boolean) => void,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const savedRef = useRef(0);
  // Position and duration of the video this effect run belongs to. Only its
  // own events update them (see `mine` below), so the cleanup can save them
  // even though the element already points at the next file by then.
  const lastTimeRef = useRef(0);
  const lastDurationRef = useRef(0);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const handledTokenRef = useRef(startToken);
  const loadedIdRef = useRef<string | null>(null);
  const flashTimer = useRef<number | null>(null);

  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(() => clampVolume(readPref("volume", 1)));
  const [muted, setMuted] = useState(false);
  const [speed, setSpeedState] = useState(1);
  /** Seconds the video resumed at, shown with a Start over button. */
  const [resumedFrom, setResumedFrom] = useState<number | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  /** The element gave up on its source (an expired stream, an unplayable file). */
  const [failed, setFailed] = useState(false);

  // Refs so the per-video effect applies the current speed and volume
  // without re-running when they change.
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 700);
  }, []);

  const save = useCallback(
    (force = false) => {
      const el = videoRef.current;
      if (!el) return;
      const snap = playbackSnapshot(el.currentTime, finite(el.duration) || lastDurationRef.current);
      if (!force && Math.abs(snap.position - savedRef.current) < SAVE_EVERY) return;
      savedRef.current = snap.position;
      persist(video.id, snap.position, snap.watched);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [video.id],
  );

  const persist = (id: string, position: number, watched: boolean) => {
    api.updatePlayback(id, position, watched).catch(() => {});
    onSavedRef.current(id, position, watched);
  };

  const play = useCallback(() => {
    videoRef.current?.play().catch(() => showFlash("Press play to start"));
  }, [showFlash]);

  // One run per video: reset, then resume and play once metadata is in.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    loadedIdRef.current = video.id;
    setPosition(0);
    setDuration(0);
    setPlaying(false);
    setResumedFrom(null);
    setFailed(false);
    el.playbackRate = speedRef.current;
    el.volume = volumeRef.current;
    savedRef.current = 0;
    lastTimeRef.current = 0;
    lastDurationRef.current = 0;

    // No source yet (a stream still resolving). Dropping the src attribute
    // does not unload a media element: the previous video would keep
    // playing, and its events would count for this one. So it is unloaded
    // here, and nothing listens until the source arrives (the next run).
    if (!src) {
      el.pause();
      if (el.hasAttribute("src")) el.removeAttribute("src");
      el.load();
      return;
    }

    // The element's src for this video. When the next video loads, the old
    // file's last events (a final timeupdate at 0, emptied) can still arrive
    // after the listeners changed hands; checking the source rather than the
    // event order keeps each run to its own file. `el.src` (the attribute
    // React sets synchronously), not `currentSrc`, which updates later.
    const current = el.src;
    const mine = () => el.src === current;
    let started = false;
    const onLoaded = () => {
      if (!mine() || started) return;
      started = true;
      // A live stream reports an infinite duration: no seek bar, no resume.
      const length = finite(el.duration);
      lastDurationRef.current = length;
      setDuration(length);
      const at = video.last_position ?? 0;
      if (at > 5 && length > 0 && at < length - 10) {
        el.currentTime = at;
        setResumedFrom(at);
      }
      play();
    };
    const onTime = () => {
      if (!mine()) return;
      if (el.currentTime !== stalledAt) clearStall();
      lastTimeRef.current = el.currentTime;
      if (finite(el.duration)) lastDurationRef.current = el.duration;
      setPosition(el.currentTime);
      if (Math.abs(el.currentTime - savedRef.current) >= SAVE_EVERY) save();
    };
    const onEnd = () => {
      if (!mine()) return;
      setPlaying(false);
      save(true);
      onEndedRef.current();
    };
    const onError = () => {
      if (mine() && el.getAttribute("src")) setFailed(true);
    };
    // A stream whose URL expired often just stops loading, without an
    // error event. Stuck for STALL_LIMIT while trying to play counts as
    // failed, so the player offers Try again.
    let stall: number | null = null;
    let stalledAt = -1;
    const clearStall = () => {
      if (stall !== null) window.clearTimeout(stall);
      stall = null;
    };
    // A wait at a new position (a seek included) re-arms the timer from
    // there; repeated `stalled` events at the same second do not push it back.
    const onWaiting = () => {
      if (!mine() || !isWeb(src)) return;
      if (stall !== null && el.currentTime === stalledAt) return;
      clearStall();
      stalledAt = el.currentTime;
      stall = window.setTimeout(() => {
        stall = null;
        if (mine() && !el.paused && el.currentTime === stalledAt && el.readyState < 3) setFailed(true);
      }, STALL_LIMIT_MS);
    };
    // Back on its feet by itself: the "stream stopped" overlay goes.
    const onPlaying = () => {
      clearStall();
      if (mine()) setFailed(false);
    };
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    el.addEventListener("error", onError);
    el.addEventListener("waiting", onWaiting);
    el.addEventListener("stalled", onWaiting);
    el.addEventListener("seeking", onWaiting);
    el.addEventListener("playing", onPlaying);
    el.addEventListener("pause", clearStall);
    // A local file can reach HAVE_METADATA before this effect runs.
    if (el.readyState >= 1) onLoaded();
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      el.removeEventListener("error", onError);
      el.removeEventListener("waiting", onWaiting);
      el.removeEventListener("stalled", onWaiting);
      el.removeEventListener("seeking", onWaiting);
      el.removeEventListener("playing", onPlaying);
      el.removeEventListener("pause", clearStall);
      clearStall();
      const snap = playbackSnapshot(lastTimeRef.current, lastDurationRef.current);
      if (snap.position > 0 && snap.position !== savedRef.current) {
        persist(video.id, snap.position, snap.watched);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id, src]);

  // Started again on purpose while the same video is loaded: from the top.
  useEffect(() => {
    if (startToken === handledTokenRef.current) return;
    handledTokenRef.current = startToken;
    const el = videoRef.current;
    if (!el || loadedIdRef.current !== video.id || el.readyState < 1) return;
    el.currentTime = 0;
    setResumedFrom(null);
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startToken]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.loop = repeat;
  }, [repeat, video.id]);

  const toggle = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) play();
    else el.pause();
  }, [play]);

  const seek = useCallback((seconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(seconds, finite(el.duration) || seconds));
    setPosition(el.currentTime);
    setResumedFrom(null);
  }, []);

  const skip = useCallback(
    (delta: number) => {
      const el = videoRef.current;
      if (!el) return;
      seek(el.currentTime + delta);
      showFlash(delta > 0 ? `+${delta}s` : `−${-delta}s`);
    },
    [seek, showFlash],
  );

  const setVolume = useCallback((next: number) => {
    const el = videoRef.current;
    const value = clampVolume(next);
    if (el) {
      el.volume = value;
      el.muted = value === 0;
    }
    setVolumeState(value);
    setMuted(value === 0);
    writePref("volume", value);
  }, []);

  const toggleMute = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  }, []);

  const setSpeed = useCallback(
    (next: number) => {
      if (videoRef.current) videoRef.current.playbackRate = next;
      setSpeedState(next);
      showFlash(`${next}×`);
    },
    [showFlash],
  );

  const startOver = useCallback(() => {
    seek(0);
    play();
  }, [seek, play]);

  return {
    videoRef,
    playing,
    setPlaying,
    position,
    duration,
    volume,
    muted,
    speed,
    resumedFrom,
    dismissResumed: () => setResumedFrom(null),
    flash,
    failed,
    /** Seconds played of the current run, for a retry that resumes there. */
    lastTime: () => lastTimeRef.current,
    toggle,
    seek,
    skip,
    setVolume,
    toggleMute,
    setSpeed,
    startOver,
  };
}

export type Playback = ReturnType<typeof usePlayback>;

/** A duration as a number to compute with: 0 for unknown or live (Infinity). */
function finite(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}
