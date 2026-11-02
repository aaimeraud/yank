import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Folder, Video } from "../types";
import { ALL, UNFILED, filterVideos } from "../lib/libraryFilter";

export function useLibrary() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL);

  const refresh = useCallback(async () => {
    const [nextVideos, nextFolders] = await Promise.all([
      invoke<Video[]>("list_videos"),
      invoke<Folder[]>("list_folders"),
    ]);
    setVideos(nextVideos);
    setFolders(nextFolders);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Deleting the folder being viewed must not leave the grid filtered by an id
  // that no longer exists.
  useEffect(() => {
    if (
      selectedFolder !== ALL &&
      selectedFolder !== UNFILED &&
      !folders.some((folder) => folder.id === selectedFolder)
    ) {
      setSelectedFolder(ALL);
    }
  }, [folders, selectedFolder]);

  // The visible order is the implicit autoplay queue, so it lives here where
  // both the grid and the player can read the same list.
  const visibleVideos = useMemo(
    () => filterVideos(videos, selectedFolder),
    [videos, selectedFolder],
  );
  const unfiledCount = useMemo(
    () => videos.filter((video) => !video.folder_id).length,
    [videos],
  );

  // Every mutation refreshes both lists: moving a video changes a folder count,
  // and deleting a folder changes every video that was inside it.
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await refresh();
        return true;
      } catch (e) {
        alert(String(e));
        return false;
      }
    },
    [refresh],
  );

  const createFolder = useCallback(
    async (name: string) => {
      try {
        const folder = await invoke<Folder>("create_folder", { name });
        await refresh();
        return folder;
      } catch (e) {
        alert(String(e));
        return null;
      }
    },
    [refresh],
  );
  const renameFolder = useCallback(
    (id: string, name: string) => run(() => invoke("rename_folder", { id, name })),
    [run],
  );
  const deleteFolder = useCallback(
    (id: string) => run(() => invoke("delete_folder", { id })),
    [run],
  );
  const moveVideos = useCallback(
    async (videoIds: string[], folderId: string | null) => {
      if (videoIds.length === 0) return true;
      try {
        // Sequential on purpose: one SQLite writer, and a failure stops before
        // touching the rest. The refresh below shows exactly what landed.
        for (const videoId of videoIds) {
          await invoke("move_video", { videoId, folderId });
        }
        await refresh();
        return true;
      } catch (e) {
        alert(String(e));
        await refresh();
        return false;
      }
    },
    [refresh],
  );
  const removeVideos = useCallback(
    async (videoIds: string[], deleteFile: boolean) => {
      if (videoIds.length === 0) return true;
      try {
        for (const videoId of videoIds) {
          await invoke("remove_video", { videoId, deleteFile });
        }
        await refresh();
        return true;
      } catch (e) {
        alert(String(e));
        await refresh();
        return false;
      }
    },
    [refresh],
  );

  return {
    videos,
    folders,
    visibleVideos,
    unfiledCount,
    selectedFolder,
    setSelectedFolder,
    refresh,
    createFolder,
    renameFolder,
    deleteFolder,
    moveVideos,
    removeVideos,
  };
}
