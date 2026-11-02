import { useEffect, useRef, useState } from "react";
import type { Folder, Video } from "../types";
import { ALL, UNFILED } from "../lib/libraryFilter";
import FolderBar from "./FolderBar";
import VideoCard from "./VideoCard";

interface Props {
  videos: Video[];
  total: number;
  unfiled: number;
  selected: string;
  folders: Folder[];
  onSelect: (id: string) => void;
  onPlay: (video: Video) => void;
  onDownload: (video: Video) => void;
  onPlayNext: (video: Video) => void;
  onQueue: (video: Video) => void;
  onCreateFolder: (name: string) => Promise<Folder | null>;
  onRenameFolder: (id: string, name: string) => Promise<unknown>;
  onDeleteFolder: (id: string) => Promise<unknown>;
  onMoveVideos: (
    videoIds: string[],
    folderId: string | null,
  ) => Promise<boolean | void> | boolean | void;
  onRemoveVideos: (
    videoIds: string[],
    deleteFile: boolean,
  ) => Promise<boolean | void> | boolean | void;
}

export default function Library({
  videos,
  total,
  unfiled,
  selected,
  folders,
  onSelect,
  onPlay,
  onDownload,
  onPlayNext,
  onQueue,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveVideos,
  onRemoveVideos,
}: Props) {
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<"move" | "delete" | null>(null);
  const toolsRef = useRef<HTMLDivElement>(null);

  const activeFolder = folders.find((folder) => folder.id === selected);

  const empty =
    selected === ALL
      ? "No videos yet."
      : selected === UNFILED
        ? "No unfiled videos."
        : `Nothing in "${activeFolder?.name ?? "this folder"}" yet.`;

  const exitSelection = () => {
    setSelecting(false);
    setSelectedIds(new Set());
    setMenu(null);
  };

  // A folder switch is a new context; keeping a selection that is no longer on
  // screen would make the next bulk action hit videos the user cannot see.
  useEffect(() => {
    setSelecting(false);
    setSelectedIds(new Set());
    setMenu(null);
  }, [selected]);

  // A refresh can remove rows (a finished download, a deleted file). Drop those
  // ids from the selection instead of acting on stale ones.
  useEffect(() => {
    setSelectedIds((current) => {
      if (current.size === 0) return current;
      const live = new Set(videos.map((video) => video.id));
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [videos]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!toolsRef.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  useEffect(() => {
    if (!selecting) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu) {
        setMenu(null);
      } else {
        setSelecting(false);
        setSelectedIds(new Set());
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selecting, menu]);

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const chosenIds = () =>
    videos.filter((video) => selectedIds.has(video.id)).map((video) => video.id);

  const runBulk = async (action: () => Promise<boolean | void> | boolean | void) => {
    const result = await action();
    // A failed action keeps the selection so the user can retry it.
    if (result === false) return;
    exitSelection();
  };

  const bulkMove = (folderId: string | null) => {
    const ids = chosenIds();
    if (ids.length === 0) return;
    setMenu(null);
    void runBulk(() => onMoveVideos(ids, folderId));
  };

  const bulkRemove = (deleteFile: boolean) => {
    const ids = chosenIds();
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? "video" : "videos";
    const prompt = deleteFile
      ? `Delete ${ids.length} ${noun} from disk? This cannot be undone.`
      : `Remove ${ids.length} ${noun} from the library?`;
    if (!confirm(prompt)) return;
    setMenu(null);
    void runBulk(() => onRemoveVideos(ids, deleteFile));
  };

  return (
    <>
      <FolderBar
        folders={folders}
        total={total}
        unfiled={unfiled}
        selected={selected}
        onSelect={onSelect}
        onCreate={onCreateFolder}
        onRename={onRenameFolder}
        onDelete={onDeleteFolder}
      />

      {videos.length > 0 && (
        <div className="library-tools">
          {selecting && (
            <span className="bulk-count">
              {selectedIds.size} selected
            </span>
          )}
          <div className="library-tools-actions" ref={toolsRef}>
            {selecting ? (
              <>
                <button
                  className="tool-link"
                  onClick={() =>
                    setSelectedIds(
                      selectedIds.size === videos.length
                        ? new Set()
                        : new Set(videos.map((video) => video.id)),
                    )
                  }
                >
                  {selectedIds.size === videos.length ? "Clear" : "Select all"}
                </button>
                <div className="bulk-menu-wrap">
                  <button
                    className="bulk-action"
                    disabled={selectedIds.size === 0}
                    onClick={() => setMenu(menu === "move" ? null : "move")}
                  >
                    Move to
                  </button>
                  {menu === "move" && (
                    <div className="card-menu bulk-menu">
                      <button onClick={() => bulkMove(null)}>No folder</button>
                      {folders.map((folder) => (
                        <button key={folder.id} onClick={() => bulkMove(folder.id)}>
                          {folder.name}
                        </button>
                      ))}
                      {folders.length === 0 && (
                        <span className="menu-empty">No folders yet</span>
                      )}
                    </div>
                  )}
                </div>
                <div className="bulk-menu-wrap">
                  <button
                    className="bulk-action danger"
                    disabled={selectedIds.size === 0}
                    onClick={() => setMenu(menu === "delete" ? null : "delete")}
                  >
                    Delete
                  </button>
                  {menu === "delete" && (
                    <div className="card-menu bulk-menu">
                      <button onClick={() => bulkRemove(false)}>Remove from library</button>
                      <button className="danger" onClick={() => bulkRemove(true)}>
                        Delete files…
                      </button>
                    </div>
                  )}
                </div>
                <button className="bulk-done" onClick={exitSelection}>
                  Done
                </button>
              </>
            ) : (
              <button className="tool-link" onClick={() => setSelecting(true)}>
                Select
              </button>
            )}
          </div>
        </div>
      )}

      {videos.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="grid">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              folders={folders}
              selecting={selecting}
              selected={selectedIds.has(video.id)}
              onToggleSelect={toggleSelect}
              onPlay={onPlay}
              onDownload={onDownload}
              onPlayNext={onPlayNext}
              onQueue={onQueue}
              onMove={(videoId, folderId) => onMoveVideos([videoId], folderId)}
              onRemove={(videoId, deleteFile) => onRemoveVideos([videoId], deleteFile)}
            />
          ))}
        </div>
      )}
    </>
  );
}
