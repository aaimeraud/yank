import { convertFileSrc } from "@tauri-apps/api/core";
import type { Video } from "../types";

interface Props {
  videos: Video[];
  onPlay: (v: Video) => void;
  onDownload: (v: Video) => void;
}

const dur = (s: number | null) => {
  if (!s || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};

export default function Library({ videos, onPlay, onDownload }: Props) {
  if (videos.length === 0) return <p className="empty">No videos yet.</p>;
  return (
    <div className="grid">
      {videos.map((v) => (
        <div key={v.id} className="card" onClick={() => onPlay(v)} style={{ cursor: v.file_path ? "pointer" : "default" }}>
          <div className={"thumb" + (v.thumbnail_path ? " has-img" : "")}>
            {v.thumbnail_path ? <img src={convertFileSrc(v.thumbnail_path)} alt="" loading="lazy" /> : v.source}
          </div>
          {!v.file_path && (
            <button
              className="card-download"
              onClick={(e) => {
                e.stopPropagation();
                onDownload(v);
              }}
            >
              Download
            </button>
          )}
          <div className="title">{v.title}</div>
          <div className="meta">
            {v.uploader ?? "Unknown"}
            {v.duration ? ` · ${dur(v.duration)}` : ""}
            {v.watched ? " · watched" : ""}
          </div>
        </div>
      ))}
    </div>
  );
}
