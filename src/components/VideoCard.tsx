import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Folder, Video } from "../types";
import { displayTitle } from "../lib/display";
import { formatDuration } from "../lib/format";
import { confirmAction } from "../lib/confirm";
import SourceIcon from "./SourceIcon";

/** What a card can ask the library to do with its video. */
export interface CardActions {
  play: (video: Video) => void;
  download: (video: Video) => void;
  playNext: (video: Video) => void;
  queue: (video: Video) => void;
  reveal: (video: Video) => void;
  copyLink: (video: Video) => void;
  move: (videoId: string, folderId: string | null) => void;
  remove: (videoId: string, deleteFile: boolean) => void;
}

interface Props {
  video: Video;
  folders: Folder[];
  /** Bulk selection mode: a click toggles instead of playing. */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  actions: CardActions;
}

export default function VideoCard({ video, folders, selecting, selected, onToggleSelect, actions }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const label = displayTitle(video);
  const downloaded = video.file_path !== null;

  useEffect(() => {
    if (selecting) setMenuOpen(false);
  }, [selecting]);

  const activate = () => {
    if (selecting) onToggleSelect(video.id);
    else if (menuOpen) setMenuOpen(false);
    else if (downloaded) actions.play(video);
  };

  return (
    <div
      className={"card" + (selected ? " selected" : "") + (downloaded ? "" : " missing")}
      role={selecting ? "checkbox" : "button"}
      aria-checked={selecting ? selected : undefined}
      aria-label={label}
      tabIndex={0}
      onClick={activate}
      onContextMenu={(event) => {
        if (selecting) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      <Thumbnail video={video} />

      {selecting && (
        <span className={"card-check" + (selected ? " checked" : "")} aria-hidden="true">
          {selected ? "✓" : ""}
        </span>
      )}

      {!selecting && !downloaded && (
        <button
          className="card-download"
          onClick={(event) => {
            event.stopPropagation();
            actions.download(video);
          }}
        >
          Download
        </button>
      )}

      {!selecting && (
        <CardMenu
          video={video}
          folders={folders}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          actions={actions}
        />
      )}

      <div className="title" title={label}>
        {label}
      </div>
      <div className="meta">
        <SourceIcon source={video.source} size={12} />
        <span>
          {video.uploader ?? "Unknown"}
          {video.watched ? " · Watched" : ""}
          {!downloaded ? " · Not downloaded" : ""}
        </span>
      </div>
    </div>
  );
}

function Thumbnail({ video }: { video: Video }) {
  const [broken, setBroken] = useState(false);
  const watchedRatio =
    video.duration && video.last_position > 0 && !video.watched
      ? Math.min(1, video.last_position / video.duration)
      : 0;
  const showImage = video.thumbnail_path && !broken;
  return (
    <div className={"thumb" + (showImage ? " has-img" : "")}>
      {showImage ? (
        <img src={convertFileSrc(video.thumbnail_path!)} alt="" loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <span className="thumb-placeholder">
          <SourceIcon source={video.source} size={28} />
        </span>
      )}
      {video.duration ? <span className="thumb-duration">{formatDuration(video.duration)}</span> : null}
      {watchedRatio > 0 && (
        <span className="thumb-progress" style={{ width: `${watchedRatio * 100}%` }} aria-hidden="true" />
      )}
    </div>
  );
}

interface MenuProps {
  video: Video;
  folders: Folder[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: CardActions;
}

function CardMenu({ video, folders, open, onOpenChange, actions }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const downloaded = video.file_path !== null;
  const destinations = folders.filter((folder) => folder.id !== video.folder_id);

  // Close on any click outside the menu, and on Escape.
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open, onOpenChange]);

  /** Close the menu, then run the action. */
  const pick = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  const remove = async (deleteFile: boolean) => {
    onOpenChange(false);
    if (deleteFile) {
      const ok = await confirmAction(`Delete "${displayTitle(video)}" from disk? This cannot be undone.`, {
        okLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
    }
    actions.remove(video.id, deleteFile);
  };

  return (
    <div className="card-menu-wrap" ref={ref} onClick={(event) => event.stopPropagation()}>
      <button
        className={"card-menu-btn" + (open ? " open" : "")}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        ⋯
      </button>
      {open && (
        <div className="card-menu" role="menu">
          {downloaded && (
            <>
              <button role="menuitem" onClick={pick(() => actions.playNext(video))}>Play next</button>
              <button role="menuitem" onClick={pick(() => actions.queue(video))}>Add to queue</button>
              <button role="menuitem" onClick={pick(() => actions.reveal(video))}>Show in Finder</button>
            </>
          )}
          {!downloaded && (
            <button role="menuitem" onClick={pick(() => actions.download(video))}>Download</button>
          )}
          <button role="menuitem" onClick={pick(() => actions.copyLink(video))}>Copy link</button>
          <div className="menu-sep" />
          <span className="menu-label">Move to</span>
          {video.folder_id && (
            <button role="menuitem" onClick={pick(() => actions.move(video.id, null))}>No folder</button>
          )}
          {destinations.map((folder) => (
            <button role="menuitem" key={folder.id} onClick={pick(() => actions.move(video.id, folder.id))}>
              {folder.name}
            </button>
          ))}
          {destinations.length === 0 && !video.folder_id && <span className="menu-empty">No folders yet</span>}
          <div className="menu-sep" />
          <button role="menuitem" onClick={() => void remove(false)}>Remove from library</button>
          {downloaded && (
            <button role="menuitem" className="danger" onClick={() => void remove(true)}>
              Delete file…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
