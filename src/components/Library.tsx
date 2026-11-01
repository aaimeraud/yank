import { useEffect, useState } from "react";
import type { Folder, Video } from "../types";
import { ALL, UNFILED, filterVideos } from "../lib/libraryFilter";
import FolderBar from "./FolderBar";
import VideoCard from "./VideoCard";

interface Props {
  videos: Video[];
  folders: Folder[];
  onPlay: (video: Video) => void;
  onDownload: (video: Video) => void;
  onCreateFolder: (name: string) => Promise<Folder | null>;
  onRenameFolder: (id: string, name: string) => Promise<unknown>;
  onDeleteFolder: (id: string) => Promise<unknown>;
  onMoveVideo: (videoId: string, folderId: string | null) => void;
  onRemoveVideo: (videoId: string, deleteFile: boolean) => void;
}

export default function Library({
  videos,
  folders,
  onPlay,
  onDownload,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveVideo,
  onRemoveVideo,
}: Props) {
  const [selected, setSelected] = useState<string>(ALL);

  // Deleting the folder being viewed must not leave the grid filtered by an id
  // that no longer exists.
  useEffect(() => {
    if (selected !== ALL && selected !== UNFILED && !folders.some((f) => f.id === selected)) {
      setSelected(ALL);
    }
  }, [folders, selected]);

  const visible = filterVideos(videos, selected);

  const unfiled = videos.filter((video) => !video.folder_id).length;
  const activeFolder = folders.find((folder) => folder.id === selected);

  const empty =
    selected === ALL
      ? "No videos yet."
      : selected === UNFILED
        ? "No unfiled videos."
        : `Nothing in "${activeFolder?.name ?? "this folder"}" yet.`;

  return (
    <>
      <FolderBar
        folders={folders}
        total={videos.length}
        unfiled={unfiled}
        selected={selected}
        onSelect={setSelected}
        onCreate={onCreateFolder}
        onRename={onRenameFolder}
        onDelete={onDeleteFolder}
      />
      {visible.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="grid">
          {visible.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              folders={folders}
              onPlay={onPlay}
              onDownload={onDownload}
              onMove={onMoveVideo}
              onRemove={onRemoveVideo}
            />
          ))}
        </div>
      )}
    </>
  );
}
