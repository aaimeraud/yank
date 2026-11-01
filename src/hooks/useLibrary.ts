import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Folder, Video } from "../types";

export function useLibrary() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

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
  const moveVideo = useCallback(
    (videoId: string, folderId: string | null) =>
      run(() => invoke("move_video", { videoId, folderId })),
    [run],
  );
  const removeVideo = useCallback(
    (videoId: string, deleteFile: boolean) =>
      run(() => invoke("remove_video", { videoId, deleteFile })),
    [run],
  );

  return {
    videos,
    folders,
    refresh,
    createFolder,
    renameFolder,
    deleteFolder,
    moveVideo,
    removeVideo,
  };
}
