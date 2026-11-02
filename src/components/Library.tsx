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
  onMoveVideo: (videoId: string, folderId: string | null) => void;
  onRemoveVideo: (videoId: string, deleteFile: boolean) => void;
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
  onMoveVideo,
  onRemoveVideo,
}: Props) {
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
        total={total}
        unfiled={unfiled}
        selected={selected}
        onSelect={onSelect}
        onCreate={onCreateFolder}
        onRename={onRenameFolder}
        onDelete={onDeleteFolder}
      />
      {videos.length === 0 ? (
        <p className="empty">{empty}</p>
      ) : (
        <div className="grid">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
              folders={folders}
              onPlay={onPlay}
              onDownload={onDownload}
              onPlayNext={onPlayNext}
              onQueue={onQueue}
              onMove={onMoveVideo}
              onRemove={onRemoveVideo}
            />
          ))}
        </div>
      )}
    </>
  );
}
