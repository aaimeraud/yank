import { useEffect, useRef } from "react";
import { nowPlaying } from "../../lib/nowPlaying";
import type { Video } from "../../types";

interface Transport {
  playing: boolean;
  toggle: () => void;
  skip: (delta: number) => void;
}

/**
 * Tell macOS what is playing: without this, Control Center and the media
 * keys only say "Yank". Does nothing where the Media Session API is missing.
 */
export function useMediaSession(video: Video, playback: Transport, onNext: (() => void) | null, onPrevious: () => void) {
  const latest = useRef({ playback, onNext, onPrevious });
  latest.current = { playback, onNext, onPrevious };

  const { title, artist, artwork } = nowPlaying(video);
  const art = artwork[0]?.src ?? "";

  useEffect(() => {
    if (!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({ title, artist, artwork: art ? [{ src: art }] : [] });
  }, [title, artist, art]);

  const canNext = onNext !== null;
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const session = navigator.mediaSession;
    const set = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // This WebKit does not know that action.
      }
    };
    const whenPaused = (wanted: boolean) => () => {
      if (latest.current.playback.playing !== wanted) latest.current.playback.toggle();
    };
    set("play", whenPaused(true));
    set("pause", whenPaused(false));
    set("seekbackward", () => latest.current.playback.skip(-10));
    set("seekforward", () => latest.current.playback.skip(10));
    set("nexttrack", canNext ? () => latest.current.onNext?.() : null);
    set("previoustrack", () => latest.current.onPrevious());
    return () => {
      for (const action of ["play", "pause", "seekbackward", "seekforward", "nexttrack", "previoustrack"] as const) set(action, null);
    };
  }, [canNext]);

  useEffect(
    () => () => {
      if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
    },
    [],
  );
}
