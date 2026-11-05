import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { playbackSnapshot } from "../../lib/playback";
import { readPref, writePref } from "../../lib/prefs";
import type { Video } from "../../types";

/** Save the position every this many seconds of playback. */
const SAVE_EVERY = 5;

/**
 * Everything about the one <video> element: start each new video (resuming
 * where it stopped), keep its position saved, and expose the controls.
 *
 * `startToken` changes whenever the user starts a video on purpose. A new id
 * loads and plays; the same id restarts from the beginning (Play again).
 */
export function usePlayback(
  video: Video,
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
      const snap = playbackSnapshot(el.currentTime, el.duration || lastDurationRef.current);
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
    el.playbackRate = speedRef.current;
    el.volume = volumeRef.current;
    savedRef.current = 0;
    lastTimeRef.current = 0;
    lastDurationRef.current = 0;

    // The element's src for this video. When the next video loads, the old
    // file's last events (a final timeupdate at 0, emptied) can still arrive
    // after the listeners changed hands; checking the source rather than the
    // event order keeps each run to its own file. `el.src` (the attribute
    // React sets synchronously), not `currentSrc`, which updates later.
    const src = el.src;
    const mine = () => el.src === src;
    let started = false;
    const onLoaded = () => {
      if (!mine() || started) return;
      started = true;
      const length = el.duration || 0;
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
      lastTimeRef.current = el.currentTime;
      if (el.duration) lastDurationRef.current = el.duration;
      setPosition(el.currentTime);
      if (Math.abs(el.currentTime - savedRef.current) >= SAVE_EVERY) save();
    };
    const onEnd = () => {
      if (!mine()) return;
      setPlaying(false);
      save(true);
      onEndedRef.current();
    };
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnd);
    // A local file can reach HAVE_METADATA before this effect runs.
    if (el.readyState >= 1) onLoaded();
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnd);
      const snap = playbackSnapshot(lastTimeRef.current, lastDurationRef.current);
      if (snap.position > 0 && snap.position !== savedRef.current) {
        persist(video.id, snap.position, snap.watched);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

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
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || seconds));
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

function clampVolume(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1;
}
