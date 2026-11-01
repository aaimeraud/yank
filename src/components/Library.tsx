import type { Video } from "../types";

interface Props {
  videos: Video[];
  onPlay: (v: Video) => void;
}

export default function Library({ videos, onPlay }: Props) {
  if (videos.length === 0) return <p className="empty">No videos yet.</p>;
  return (
    <div className="grid">
      {videos.map((v) => (
        <div key={v.id} className="card" onClick={() => onPlay(v)} style={{ cursor: v.file_path ? "pointer" : "default" }}>
          <div className="thumb">{v.source}</div>
          <div className="title">{v.title}</div>
          <div className="meta">{v.uploader ?? "Unknown"}{v.watched ? " • watched" : ""}</div>
        </div>
      ))}
    </div>
  );
}