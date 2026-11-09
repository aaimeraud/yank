import { useEffect, useRef, useState } from "react";
import type { Video } from "../../types";
import type { PlayerMode, PlayerSource } from "../../hooks/usePlayer";
import { mediaSrc } from "../../lib/media";
import { displayTitle } from "../../lib/display";
import { formatClock, formatDuration } from "../../lib/format";
import { sourceLabel } from "../../lib/source";
import SourceIcon from "../SourceIcon";
import ThumbImage from "../ThumbImage";
import { DownloadsIcon, FinderIcon, LinkIcon, PlayIcon } from "../icons";
import Controls from "./Controls";
import MiniBar from "./MiniBar";
import { usePlayback } from "./usePlayback";

interface Props {
  video: Video;
  /** Where the media comes from: the file on disk, or a stream (ADR 0010). */
  source: PlayerSource;
  mode: PlayerMode;
  startToken: number;
  nextVideo: Video | null;
  canPrevious: boolean;
  autoplay: boolean;
  repeat: boolean;
  queueOpen: boolean;
  onEnded: () => void;
  /** A position was saved; keeps the library's copy (resume, watched bar) current. */
  onSaved: (videoId: string, position: number, watched: boolean) => void;
  onNext: () => void;
  onPrevious: () => void;
  onToggleAutoplay: () => void;
  onToggleRepeat: () => void;
  onToggleQueue: () => void;
  onExpand: () => void;
  onMinimize: () => void;
  onClose: () => void;
  onReveal: () => void;
  onCopyLink: () => void;
  /** Download what is streaming; null when that is not possible (a live). */
  onDownload: (() => void) | null;
  /** Resolve the stream again and resume at `position` seconds. */
  onRetryStream: (position: number) => void;
  /** The element gave up on the stream (true), or recovered by itself (false). */
  onStreamFailed: (failed: boolean) => void;
}

/**
 * The app's one player. It stays mounted while something plays, whatever
 * screen is open: `mode` only changes its frame, from the full player screen
 * to the mini player in the corner. The stage is always the first child, so
 * React keeps the same <video> element and playback never restarts.
 */
export default function Player(props: Props) {
  const { video, mode, source } = props;
  const shellRef = useRef<HTMLDivElement>(null);
  const playback = usePlayback(video, source.src, props.startToken, props.repeat, props.onEnded, props.onSaved);
  const problem = source.error ?? (playback.failed ? failureText(source) : null);
  const reportFailure = useRef(props.onStreamFailed);
  reportFailure.current = props.onStreamFailed;
  useEffect(() => {
    if (source.streaming) reportFailure.current(playback.failed);
  }, [playback.failed, source.streaming]);
  const [fullscreen, setFullscreen] = useState(false);
  const idle = useIdle(fullscreen && playback.playing);

  // Previous restarts the video once it has played a little, like every
  // music player; pressed again within 3 seconds it goes back.
  const previous = () => {
    if (playback.position > 3 || !props.canPrevious) playback.startOver();
    else props.onPrevious();
  };
  const transport = {
    playback,
    canPrevious: props.canPrevious,
    canNext: props.nextVideo !== null,
    onPrevious: previous,
    onNext: props.onNext,
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void shellRef.current?.requestFullscreen();
  };
  const pictureInPicture = async () => {
    const el = playback.videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      // Not available for this file.
    }
  };

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === shellRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Leaving fullscreen when the player shrinks to the corner.
  useEffect(() => {
    if (mode === "mini" && document.fullscreenElement) void document.exitFullscreen();
  }, [mode]);

  useShortcuts(mode === "full", {
    toggle: playback.toggle,
    skip: playback.skip,
    volume: (delta) => playback.setVolume(playback.volume + delta),
    mute: playback.toggleMute,
    fullscreen: toggleFullscreen,
    queue: props.onToggleQueue,
    next: props.onNext,
    previous,
    mini: props.onMinimize,
  });

  return (
    <div
      ref={shellRef}
      className={`player ${mode}` + (fullscreen ? " is-fullscreen" : "") + (idle ? " idle" : "")}
      aria-label={mode === "mini" ? `Mini player: ${displayTitle(video)}` : undefined}
      role={mode === "mini" ? "region" : undefined}
    >
      <div className="player-stage" key="stage">
        <video
          ref={playback.videoRef}
          src={source.src}
          poster={video.thumbnail_path ? mediaSrc(video.thumbnail_path) : undefined}
          preload="metadata"
          onClick={mode === "mini" ? props.onExpand : playback.toggle}
          onDoubleClick={mode === "full" ? toggleFullscreen : undefined}
          onPlay={() => playback.setPlaying(true)}
          onPause={() => playback.setPlaying(false)}
        />
        {mode === "full" && !playback.playing && !source.loading && !problem && (
          <button className="vv-bigplay" onClick={playback.toggle} aria-label="Play">
            <PlayIcon size={28} />
          </button>
        )}
        {source.loading && (
          <div className="vv-status" role="status">
            <span className="spinner" aria-hidden="true" />
            {mode === "full" && <span>Loading the stream…</span>}
          </div>
        )}
        {problem && (
          <div className="vv-status vv-problem" role="alert">
            {mode === "full" ? <span>{problem}</span> : <span>Stream stopped</span>}
            {source.streaming && (
              <button onClick={() => props.onRetryStream(playback.lastTime())}>Try again</button>
            )}
          </div>
        )}
        {playback.flash && <div className="vv-flash">{playback.flash}</div>}
        {mode === "full" && playback.resumedFrom !== null && (
          <div className="vv-resumed">
            <span>Resumed at {formatClock(playback.resumedFrom)}</span>
            <button onClick={playback.startOver}>Start over</button>
            <button className="quiet" onClick={playback.dismissResumed} aria-label="Dismiss">
              Dismiss
            </button>
          </div>
        )}
        {fullscreen && <Controls {...transport} {...controlProps(props, toggleFullscreen, pictureInPicture)} />}
      </div>

      {mode === "mini" ? (
        <MiniBar
          video={video}
          queueOpen={props.queueOpen}
          onExpand={props.onExpand}
          onClose={props.onClose}
          onToggleQueue={props.onToggleQueue}
          {...transport}
        />
      ) : (
        <>
          {!fullscreen && <Controls {...transport} {...controlProps(props, toggleFullscreen, pictureInPicture)} />}
          <VideoInfo
            video={video}
            source={source}
            nextVideo={props.nextVideo}
            onNext={props.onNext}
            onReveal={props.onReveal}
            onCopyLink={props.onCopyLink}
            onDownload={props.onDownload}
            onChooseQuality={props.onChooseQuality}
          />
        </>
      )}
    </div>
  );
}

function controlProps(props: Props, fullscreen: () => void, pip: () => void) {
  return {
    autoplay: props.autoplay,
    repeat: props.repeat,
    queueOpen: props.queueOpen,
    onToggleAutoplay: props.onToggleAutoplay,
    onToggleRepeat: props.onToggleRepeat,
    onToggleQueue: props.onToggleQueue,
    onMinimize: props.onMinimize,
    onPictureInPicture: () => void pip(),
    onFullscreen: fullscreen,
  };
}

/** What to say when the element gave up on its source. */
function failureText(source: PlayerSource): string {
  if (!source.streaming) return "This file cannot be played here. Show it in Finder to open it in another player.";
  return "The stream stopped. Its link may have expired, or the connection dropped.";
}

interface InfoProps {
  video: Video;
  source: PlayerSource;
  nextVideo: Video | null;
  onNext: () => void;
  onReveal: () => void;
  onCopyLink: () => void;
  onDownload: (() => void) | null;
  onChooseQuality: (() => void) | null;
}

/** Under the controls: the title, where it comes from, and what plays next. */
function VideoInfo({ video, source, nextVideo, onNext, onReveal, onCopyLink, onDownload, onChooseQuality }: InfoProps) {
  const meta = [
    video.uploader ?? "Unknown",
    source.isLive ? "Live" : formatDuration(video.duration),
    source.streaming ? "Streaming" : "",
    video.watched ? "Watched" : "",
  ].filter(Boolean);
  return (
    <div className="vv-info">
      <div className="vv-head">
        <div className="vv-source">
          <SourceIcon source={video.source} size={14} />
          <span>{sourceLabel(video.source)}</span>
        </div>
        <h1 className="vv-title">{displayTitle(video)}</h1>
        <p className="vv-meta">{meta.join(" · ")}</p>
        <div className="vv-actions">
          {source.streaming && onDownload && (
            <button onClick={onDownload}>
              <DownloadsIcon /> Download
            </button>
          )}
          {source.streaming && onChooseQuality && <button onClick={onChooseQuality}>Choose quality…</button>}
          {!source.streaming && (
            <button onClick={onReveal}>
              <FinderIcon /> Show in Finder
            </button>
          )}
          <button onClick={onCopyLink}>
            <LinkIcon /> Copy link
          </button>
        </div>
      </div>
      {nextVideo && (
        <button className="vv-upnext" onClick={onNext} title="Play it now (Shift+N)">
          <span className="vv-upnext-thumb">
            <ThumbImage video={nextVideo} size={18} />
          </span>
          <span className="vv-upnext-text">
            <span className="vv-upnext-label">Up next</span>
            <span className="vv-upnext-title">{displayTitle(nextVideo)}</span>
          </span>
        </button>
      )}
    </div>
  );
}

interface Shortcuts {
  toggle: () => void;
  skip: (delta: number) => void;
  volume: (delta: number) => void;
  mute: () => void;
  fullscreen: () => void;
  queue: () => void;
  next: () => void;
  previous: () => void;
  mini: () => void;
}

/** The player's keyboard, active on the player screen only. */
function useShortcuts(enabled: boolean, actions: Shortcuts) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      // A dialog is open over the player: the keys belong to it.
      if (document.querySelector("[aria-modal='true']")) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target?.closest("button, a, [role='menuitem']") && (event.key === " " || event.key === "Enter")) return;
      const a = ref.current;
      const handlers: Record<string, () => void> = {
        " ": a.toggle,
        k: a.toggle,
        ArrowLeft: () => a.skip(-10),
        j: () => a.skip(-10),
        ArrowRight: () => a.skip(10),
        l: () => a.skip(10),
        ArrowUp: () => a.volume(0.1),
        ArrowDown: () => a.volume(-0.1),
        m: a.mute,
        f: a.fullscreen,
        q: a.queue,
        i: a.mini,
        N: a.next,
        P: a.previous,
      };
      const handler = handlers[event.key];
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}

/** True after 2.5s without pointer movement, while `active`. Hides fullscreen chrome. */
function useIdle(active: boolean) {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!active) {
      setIdle(false);
      return;
    }
    let timer = window.setTimeout(() => setIdle(true), 2500);
    const wake = () => {
      setIdle(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setIdle(true), 2500);
    };
    window.addEventListener("pointermove", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", wake);
      window.removeEventListener("keydown", wake);
    };
  }, [active]);
  return idle;
}
