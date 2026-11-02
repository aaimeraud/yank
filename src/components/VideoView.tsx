import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Video } from "../types";
import { playbackSnapshot } from "../lib/playback";
import SourceIcon, { sourceLabel } from "./SourceIcon";
import {
  Back10Icon,
  CloseIcon,
  Forward10Icon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PiPIcon,
  PlayIcon,
  QueueIcon,
  VolumeIcon,
} from "./icons";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return "0:00";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
};

interface Props {
  video: Video;
  /** Start this video without a click; used when autoplay moves the tab on. */
  autoPlay: boolean;
  /** Increments when "play now" targets the video already on screen. */
  playSignal: number;
  queue: Video[];
  onEnded: () => void;
  onPlayQueued: (video: Video) => void;
  onRemoveFromQueue: (id: string) => void;
  onClearQueue: () => void;
  /** Called when the queue panel opens, so stale files can be pruned. */
  onQueueOpened: () => void;
}

export default function VideoView({
  video,
  autoPlay,
  playSignal,
  queue,
  onEnded,
  onPlayQueued,
  onRemoveFromQueue,
  onClearQueue,
  onQueueOpened,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef(0);
  // The element is already pointed at the next tab's file when this effect
  // cleans up, so the position and duration have to be captured while it still
  // plays. Reading el.duration in cleanup would compare against the wrong file.
  const lastTimeRef = useRef(0);
  const lastDurationRef = useRef(0);
  // Set when the element drops this source. From that moment on, events belong
  // to the next file, so cleanup must use the frozen snapshot instead.
  const frozenRef = useRef<{ position: number; duration: number } | null>(null);
  const flashTimer = useRef<number | null>(null);
  // The ended listener is installed once per video, so it reads the latest
  // handler through a ref instead of re-binding (and resetting) the element.
  const onEndedRef = useRef(onEnded);
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);
  const onQueueOpenedRef = useRef(onQueueOpened);
  useEffect(() => {
    onQueueOpenedRef.current = onQueueOpened;
  }, [onQueueOpened]);
  // Mounting must not replay a signal left over from a previous visit.
  const handledSignalRef = useRef(playSignal);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("yank.volume") ?? 1));
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showResume, setShowResume] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const save = (force = false) => {
    const el = videoRef.current;
    if (!el) return;
    const { position, watched } = playbackSnapshot(
      el.currentTime,
      el.duration || lastDurationRef.current,
    );
    if (!force && Math.abs(position - savedRef.current) < 5) return;
    savedRef.current = position;
    invoke("update_playback", { videoId: video.id, position, watched }).catch(() => {});
  };

  const showFlash = (text: string) => {
    setFlash(text);
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 650);
  };

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    setProgress(0);
    setDuration(0);
    setShowResume(false);
    setPlaying(false);
    setSpeed(1);
    el.playbackRate = 1;
    el.volume = volume;
    savedRef.current = 0;
    lastTimeRef.current = 0;
    lastDurationRef.current = 0;
    frozenRef.current = null;

    let detached = false;
    let started = false;
    const onLoaded = () => {
      if (detached || started) return;
      started = true;
      const d = el.duration || 0;
      lastDurationRef.current = d;
      setDuration(d);
      const pos = video.last_position ?? 0;
      const resumable = pos > 5 && d > 0 && pos < d - 10;
      // Autoplay resumes silently: asking "Resume from?" on a video the user
      // never touched would break the whole point of playing the folder.
      if (autoPlay) {
        if (resumable) el.currentTime = pos;
        el.play().catch(() => showFlash("Press play to start"));
      } else if (resumable) {
        setShowResume(true);
      }
    };
    const onTime = () => {
      if (detached) return;
      lastTimeRef.current = el.currentTime;
      if (el.duration) lastDurationRef.current = el.duration;
      setProgress(el.currentTime);
      if (Math.abs(el.currentTime - savedRef.current) >= 5) save();
    };
    const onEnded = () => {
      setPlaying(false);
      save(true);
      onEndedRef.current();
    };
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);
    const onEmptied = () => {
      // Changing src resets currentTime to 0 and fires one last timeupdate for
      // this listener before React runs the cleanup. Freezing here keeps the
      // position and duration of the video that actually played.
      detached = true;
      frozenRef.current = {
        position: lastTimeRef.current,
        duration: lastDurationRef.current,
      };
    };

    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("emptied", onEmptied);
    el.addEventListener("ended", onEnded);
    document.addEventListener("fullscreenchange", onFs);
    // A local file can reach HAVE_METADATA before this passive effect runs.
    // Without the check, autoplay would wait for an event that already fired.
    if (el.readyState >= 1) onLoaded();
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("emptied", onEmptied);
      el.removeEventListener("ended", onEnded);
      document.removeEventListener("fullscreenchange", onFs);
      const frozen = frozenRef.current;
      const { position, watched } = playbackSnapshot(
        frozen?.position ?? lastTimeRef.current,
        frozen?.duration ?? lastDurationRef.current,
      );
      if (position > 0 && position !== savedRef.current) {
        invoke("update_playback", { videoId: video.id, position, watched }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

  // "Play now" on the video already on screen leaves the id unchanged, so the
  // effect above never re-runs. Restart it in place instead.
  useEffect(() => {
    if (playSignal === handledSignalRef.current) return;
    handledSignalRef.current = playSignal;
    const el = videoRef.current;
    if (!el) return;
    el.play().catch(() => showFlash("Press play to start"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSignal]);

  useEffect(() => {
    if (queueOpen) onQueueOpenedRef.current();
  }, [queueOpen]);

  const toggle = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      setShowResume(false);
      el.play();
    } else {
      el.pause();
    }
  };

  const skip = (delta: number) => {
    const el = videoRef.current;
    if (!el) return;
    const d = el.duration || 0;
    el.currentTime = Math.min(Math.max(el.currentTime + delta, 0), d || Number.MAX_SAFE_INTEGER);
    setProgress(el.currentTime);
    showFlash(delta > 0 ? "+10s" : "−10s");
  };

  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Number(e.target.value);
    setProgress(el.currentTime);
  };

  const changeVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = videoRef.current;
    if (!el) return;
    const v = Number(e.target.value);
    el.volume = v;
    el.muted = v === 0;
    setVolume(v);
    setMuted(v === 0);
    localStorage.setItem("yank.volume", String(v));
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    const next = !el.muted;
    el.muted = next;
    setMuted(next);
  };

  const cycleSpeed = () => {
    const el = videoRef.current;
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    if (el) el.playbackRate = next;
    showFlash(`${next}×`);
  };

  const pip = async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await el.requestPictureInPicture();
    } catch {
      // Picture-in-picture is not available for this file.
    }
  };

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen();
  };

  const resume = () => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = video.last_position;
    setShowResume(false);
    el.play();
  };

  const startOver = () => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = 0;
    setShowResume(false);
    el.play();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (t && t.closest("button, a, [role='tab']")) return;
      const el = videoRef.current;
      if (!el) return;
      switch (e.key) {
        case " ":
        case "k":
          e.preventDefault();
          toggle();
          break;
        case "ArrowLeft":
        case "j":
          e.preventDefault();
          skip(-10);
          break;
        case "ArrowRight":
        case "l":
          e.preventDefault();
          skip(10);
          break;
        case "ArrowUp":
          e.preventDefault();
          el.volume = Math.min(1, el.volume + 0.1);
          el.muted = false;
          setVolume(el.volume);
          setMuted(false);
          break;
        case "ArrowDown":
          e.preventDefault();
          el.volume = Math.max(0, el.volume - 0.1);
          setVolume(el.volume);
          break;
        case "m":
          toggleMute();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "q":
          e.preventDefault();
          setQueueOpen((open) => !open);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  const volPct = (muted ? 0 : volume) * 100;

  return (
    <div className={"videoview" + (isFullscreen ? " is-fullscreen" : "")} ref={shellRef}>
      <header className="vv-head">
        <div className="vv-source">
          <SourceIcon source={video.source} size={15} />
          <span>{sourceLabel(video.source)}</span>
        </div>
        <h1 className="vv-title">{video.title}</h1>
        <div className="vv-meta">
          {video.uploader ?? "Unknown"}
          {video.duration ? ` · ${fmt(video.duration)}` : ""}
          {video.watched ? " · Watched" : ""}
        </div>
      </header>

      {showResume && (
        <div className="vv-resume">
          <span>Resume from {fmt(video.last_position)}?</span>
          <button onClick={resume}>Resume</button>
          <button onClick={startOver}>Start over</button>
        </div>
      )}

      <div className="vv-stage">
        <video
          ref={videoRef}
          src={video.file_path ? convertFileSrc(video.file_path) : undefined}
          poster={video.thumbnail_path ? convertFileSrc(video.thumbnail_path) : undefined}
          preload="metadata"
          onClick={toggle}
          onDoubleClick={toggleFullscreen}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        />
        {!playing && (
          <button className="vv-bigplay" onClick={toggle} aria-label="Play">
            <PlayIcon size={26} />
          </button>
        )}
        {flash && <div className="vv-flash">{flash}</div>}
      </div>

      <div className="vv-controls">
        <button className="vv-primary" onClick={toggle} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
        </button>
        <button onClick={() => skip(-10)} aria-label="Back 10 seconds">
          <Back10Icon size={21} />
        </button>
        <button onClick={() => skip(10)} aria-label="Forward 10 seconds">
          <Forward10Icon size={21} />
        </button>

        <span className="vv-time">{fmt(progress)}</span>
        <input
          className="vv-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={progress}
          onChange={seek}
          aria-label="Seek"
          style={{ "--pct": `${pct}%` } as React.CSSProperties}
        />
        <span className="vv-time">{fmt(duration)}</span>

        <div className="vv-volume">
          <button onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
            {muted ? <MuteIcon size={18} /> : <VolumeIcon size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={changeVolume}
            aria-label="Volume"
            style={{ "--pct": `${volPct}%` } as React.CSSProperties}
          />
        </div>

        <button
          className={"vv-queue-btn" + (queueOpen ? " open" : "")}
          onClick={() => setQueueOpen((open) => !open)}
          aria-label="Play queue"
          aria-expanded={queueOpen}
        >
          <QueueIcon size={18} />
          {queue.length > 0 && <span className="vv-queue-badge">{queue.length}</span>}
        </button>

        <button className="vv-speed" onClick={cycleSpeed} aria-label={`Playback speed ${speed}x`}>
          {speed}×
        </button>
        <button onClick={pip} aria-label="Picture in picture">
          <PiPIcon size={18} />
        </button>
        <button onClick={toggleFullscreen} aria-label="Fullscreen">
          <FullscreenIcon size={18} />
        </button>
      </div>

      {queueOpen && (
        <section className="vv-queue" aria-label="Play queue">
          <header className="vv-queue-head">
            <div className="vv-queue-title">
              Play queue
              <span className="vv-queue-count">{queue.length}</span>
            </div>
            {queue.length > 0 && (
              <button className="vv-queue-clear" onClick={onClearQueue}>
                Clear
              </button>
            )}
          </header>
          {queue.length === 0 ? (
            <p className="vv-queue-empty">
              Nothing queued. Use ⋯ on a card, or play a folder and autoplay will
              continue in order.
            </p>
          ) : (
            <ol className="vv-queue-list">
              {queue.map((item, index) => (
                <li key={item.id}>
                  <span className="vv-queue-index">{index + 1}</span>
                  <button
                    className="vv-queue-item"
                    onClick={() => onPlayQueued(item)}
                    title={item.title}
                  >
                    {item.title}
                  </button>
                  <span className="vv-queue-duration">{fmt(item.duration ?? 0)}</span>
                  <button
                    className="vv-queue-remove"
                    onClick={() => onRemoveFromQueue(item.id)}
                    aria-label={`Remove ${item.title} from the queue`}
                  >
                    <CloseIcon size={11} />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <div className="vv-hints">
        <span><kbd>Space</kbd> play or pause</span>
        <span><kbd>←</kbd> <kbd>→</kbd> skip 10s</span>
        <span><kbd>M</kbd> mute</span>
        <span><kbd>F</kbd> fullscreen</span>
        <span><kbd>Q</kbd> queue</span>
      </div>
    </div>
  );
}
