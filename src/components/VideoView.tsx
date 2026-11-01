import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import type { Video } from "../types";
import SourceIcon, { sourceLabel } from "./SourceIcon";
import {
  Back10Icon,
  Forward10Icon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PiPIcon,
  PlayIcon,
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
}

export default function VideoView({ video }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const savedRef = useRef(0);
  const flashTimer = useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(() => Number(localStorage.getItem("yank.volume") ?? 1));
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [showResume, setShowResume] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const save = (force = false) => {
    const el = videoRef.current;
    if (!el) return;
    const sec = Math.floor(el.currentTime);
    if (!force && Math.abs(sec - savedRef.current) < 5) return;
    savedRef.current = sec;
    const watched = el.duration > 0 && el.currentTime / el.duration >= 0.9;
    invoke("update_playback", { videoId: video.id, position: sec, watched }).catch(() => {});
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

    const onLoaded = () => {
      const d = el.duration || 0;
      setDuration(d);
      const pos = video.last_position ?? 0;
      if (pos > 5 && d > 0 && pos < d - 10) setShowResume(true);
    };
    const onTime = () => {
      setProgress(el.currentTime);
      if (Math.abs(el.currentTime - savedRef.current) >= 5) save();
    };
    const onEnded = () => {
      setPlaying(false);
      save(true);
    };
    const onFs = () => setIsFullscreen(!!document.fullscreenElement);

    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("ended", onEnded);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("ended", onEnded);
      document.removeEventListener("fullscreenchange", onFs);
      save(true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.id]);

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

      <div className="vv-hints">
        <span><kbd>Space</kbd> play or pause</span>
        <span><kbd>←</kbd> <kbd>→</kbd> skip 10s</span>
        <span><kbd>M</kbd> mute</span>
        <span><kbd>F</kbd> fullscreen</span>
      </div>
    </div>
  );
}
