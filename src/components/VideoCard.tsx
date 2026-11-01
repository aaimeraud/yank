import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Folder, Video } from "../types";

interface Props {
  video: Video;
  folders: Folder[];
  onPlay: (video: Video) => void;
  onDownload: (video: Video) => void;
  onMove: (videoId: string, folderId: string | null) => void;
  onRemove: (videoId: string, deleteFile: boolean) => void;
}

const dur = (s: number | null) => {
  if (!s || s <= 0) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = Math.floor(s % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`
    : `${m}:${String(r).padStart(2, "0")}`;
};

export default function VideoCard({
  video,
  folders,
  onPlay,
  onDownload,
  onMove,
  onRemove,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

  const move = (folderId: string | null) => {
    onMove(video.id, folderId);
    setMenuOpen(false);
  };

  const remove = (deleteFile: boolean) => {
    setMenuOpen(false);
    if (deleteFile) {
      const ok = confirm(`Delete "${video.title}" from disk? This cannot be undone.`);
      if (!ok) return;
    }
    onRemove(video.id, deleteFile);
  };

  const destinations = folders.filter((folder) => folder.id !== video.folder_id);

  return (
    <div
      className="card"
      onClick={() => {
        if (menuOpen) {
          setMenuOpen(false);
          return;
        }
        onPlay(video);
      }}
      style={{ cursor: video.file_path ? "pointer" : "default" }}
    >
      <div className={"thumb" + (video.thumbnail_path ? " has-img" : "")}>
        {video.thumbnail_path ? (
          <img src={convertFileSrc(video.thumbnail_path)} alt="" loading="lazy" />
        ) : (
          video.source
        )}
      </div>

      {!video.file_path && (
        <button
          className="card-download"
          onClick={(event) => {
            event.stopPropagation();
            onDownload(video);
          }}
        >
          Download
        </button>
      )}

      <div className="card-menu-wrap" ref={menuRef} onClick={(event) => event.stopPropagation()}>
        <button
          className={"card-menu-btn" + (menuOpen ? " open" : "")}
          aria-label="More actions"
          onClick={() => setMenuOpen((open) => !open)}
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="card-menu">
            <span className="menu-label">Move to</span>
            {video.folder_id && <button onClick={() => move(null)}>No folder</button>}
            {destinations.map((folder) => (
              <button key={folder.id} onClick={() => move(folder.id)}>
                {folder.name}
              </button>
            ))}
            {destinations.length === 0 && !video.folder_id && (
              <span className="menu-empty">No folders yet</span>
            )}
            <div className="menu-sep" />
            <button onClick={() => remove(false)}>Remove from library</button>
            <button className="danger" onClick={() => remove(true)}>
              Delete file…
            </button>
          </div>
        )}
      </div>

      <div className="title">{video.title}</div>
      <div className="meta">
        {video.uploader ?? "Unknown"}
        {video.duration ? ` · ${dur(video.duration)}` : ""}
        {video.watched ? " · watched" : ""}
      </div>
    </div>
  );
}
