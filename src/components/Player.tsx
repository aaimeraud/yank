import { useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Video } from "../types";

interface Props { video: Video | null; }

export default function Player({ video }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  if (!video || !video.file_path) return null;
  const toggle = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) { el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); }
  };
  return (
    <div className="playerbar">
      <video ref={ref} src={convertFileSrc(video.file_path)} autoPlay onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
      <div className="playercontrols">
        <button onClick={toggle}>{playing ? "Pause" : "Play"}</button>
        <span className="playertitle">{video.title}</span>
      </div>
    </div>
  );
}