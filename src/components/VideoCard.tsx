import { useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Folder, QueueEntry, Video } from "../types";
import { displayTitle } from "../lib/display";
import { formatDuration, formatTransfer } from "../lib/format";
import { confirmAction } from "../lib/confirm";
import { useDismiss } from "../hooks/useDismiss";
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
  /** Position in the grid; staggers the entrance of the first rows. */
  index: number;
  /** The video's active download, if any: drawn live on the thumbnail. */
  download: QueueEntry | null;
  /** This video is in the player right now. */
  playing: boolean;
  folders: Folder[];
  /** Bulk selection mode: a click toggles instead of playing. */
  selecting: boolean;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  actions: CardActions;
}

export default function VideoCard({ video, index, download, playing, folders, selecting, selected, onToggleSelect, actions }: Props) {
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
      className={"card" + (selected ? " selected" : "") + (playing ? " playing" : "") + (downloaded ? "" : download ? " incoming" : " missing") + (menuOpen ? " menu-open" : "")}
      style={{ "--enter-delay": `${Math.min(index, 11) * 45}ms` } as React.CSSProperties}
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
      <Thumbnail video={video} download={download} />
      {playing && (
        <span className="card-playing">
          <span className="eq" aria-hidden="true"><i /><i /><i /></span>
          Playing
        </span>
      )}

      {selecting && (
        <span className={"card-check" + (selected ? " checked" : "")} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m2.5 6.25 2.25 2.25 4.75-5" />
          </svg>
        </span>
      )}

      {!selecting && !downloaded && !download && (
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
          {!downloaded && !download ? " · Not downloaded" : ""}
        </span>
      </div>
    </div>
  );
}

function Thumbnail({ video, download }: { video: Video; download: QueueEntry | null }) {
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
      {video.duration && !download ? <span className="thumb-duration">{formatDuration(video.duration)}</span> : null}
      {download ? (
        <div className="thumb-download" role="progressbar" aria-valuenow={Math.round(download.progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Download progress">
          <span className="thumb-download-text">
            {download.status === "queued"
              ? "Waiting for a slot"
              : `${Math.round(download.progress)}%  ${formatTransfer(download.speed, download.eta)}`}
          </span>
          <span className="thumb-download-bar">
            <span style={{ transform: `scaleX(${download.progress / 100})` }} />
          </span>
        </div>
      ) : watchedRatio > 0 ? (
        <span className="thumb-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${watchedRatio})` }} />
        </span>
      ) : null}
      {video.watched && <span className="thumb-watched">Watched</span>}
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

  useDismiss(ref, open, () => onOpenChange(false));

  /** Close the menu, then run the action. */
  const pick = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };

  const remove = async (deleteFile: boolean) => {
    onOpenChange(false);
    if (deleteFile) {
      const ok = await confirmAction(`Move "${displayTitle(video)}" to the Trash and remove it from the library?`, {
        okLabel: "Move to Trash",
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
              Move file to Trash…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
