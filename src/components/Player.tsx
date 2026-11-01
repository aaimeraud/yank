import { useRef, useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Video } from "../types";

interface Props { video: Video | null; }

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, "0")}`;
};

export default function Player({ video }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showResume, setShowResume] = useState(false);
  const resumedRef = useRef(false);
  const savedRef = useRef(0);

  const save = (el: HTMLVideoElement, force = false) => {
    if (!video?.id) return;
    const sec = Math.floor(el.currentTime);
    if (!force && sec === savedRef.current) return;
    savedRef.current = sec;
    const watched = el.duration > 0 && el.currentTime / el.duration >= 0.9;
    invoke("update_playback", { videoId: video.id, position: sec, watched }).catch(() => {});
  };

  useEffect(() => {
    setProgress(0);
    setDuration(0);
    setShowResume(false);
    resumedRef.current = false;
    savedRef.current = 0;
    const el = ref.current;
    if (!el || !video?.file_path) return;
    const onLoaded = () => {
      const d = el.duration || 0;
      setDuration(d);
      const pos = video.last_position ?? 0;
      if (pos > 5 && d > 0 && pos < d - 10 && !resumedRef.current) {
        setShowResume(true);
      }
    };
    const onTime = () => {
      setProgress(el.currentTime);
      save(el);
    };
    const onPause = () => save(el, true);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("pause", onPause);
    return () => {
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("pause", onPause);
      save(el, true);
    };
  }, [video]);

  const resume = () => {
    const el = ref.current;
    if (el && video) {
      el.currentTime = video.last_position;
      setShowResume(false);
      resumedRef.current = true;
    }
  };
  const dismissResume = () => { setShowResume(false); resumedRef.current = true; };

  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) { el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); }
  };
  const seek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = ref.current;
    if (!el) return;
    el.currentTime = Number(e.target.value);
    setProgress(el.currentTime);
  };
  const onVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const el = ref.current;
    if (!el) return;
    el.volume = Number(e.target.value);
    setVolume(el.volume);
  };
  const fullscreen = () => {
    const el = ref.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen();
  };

  if (!video || !video.file_path) return null;
  return (
    <div className="playerbar">
      {showResume && (
        <div className="resume">
          Resume at {fmt(video.last_position)}?
          <button onClick={resume}>Resume</button>
          <button onClick={dismissResume}>Start over</button>
        </div>
      )}
      <video
        ref={ref}
        src={convertFileSrc(video.file_path)}
        autoPlay
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="playercontrols">
        <button onClick={toggle}>{playing ? "Pause" : "Play"}</button>
        <input type="range" min={0} max={duration || 0} step={0.1} value={progress} onChange={seek} />
        <span className="time">{fmt(progress)} / {fmt(duration)}</span>
        <input type="range" min={0} max={1} step={0.01} value={volume} onChange={onVolume} aria-label="Volume" />
        <button onClick={fullscreen}>Fullscreen</button>
        <span className="playertitle">{video.title}</span>
      </div>
    </div>
  );
}
