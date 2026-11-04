import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { ALL, UNFILED, filterVideos } from "../lib/libraryFilter";
import { DEFAULT_QUERY, viewVideos, type LibraryQuery } from "../lib/libraryView";
import { attempt, succeeds } from "../lib/notify";
import type { Folder, Video } from "../types";

/**
 * The library: every video and folder, the current folder/search/filter/sort
 * selection, and the list that selection produces. `visibleVideos` is also
 * the implicit autoplay order, so the grid and the player share it.
 */
export function useLibrary() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [query, setQuery] = useState<LibraryQuery>({ folder: ALL, ...DEFAULT_QUERY });

  const refresh = useCallback(async () => {
    await succeeds(async () => {
      const [nextVideos, nextFolders] = await Promise.all([api.listVideos(), api.listFolders()]);
      setVideos(nextVideos);
      setFolders(nextFolders);
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Deleting the folder being viewed must not leave the grid filtered by an
  // id that no longer exists.
  useEffect(() => {
    const { folder } = query;
    if (folder !== ALL && folder !== UNFILED && !folders.some((f) => f.id === folder)) {
      setQuery((current) => ({ ...current, folder: ALL }));
    }
  }, [folders, query]);

  const visibleVideos = useMemo(() => viewVideos(videos, query), [videos, query]);
  const folderTotal = useMemo(() => filterVideos(videos, query.folder).length, [videos, query.folder]);
  const unfiledCount = useMemo(() => videos.filter((video) => !video.folder_id).length, [videos]);

  const updateQuery = useCallback((patch: Partial<LibraryQuery>) => {
    setQuery((current) => ({ ...current, ...patch }));
  }, []);

  /** Run a mutation, then reload: moving a video changes a folder count too. */
  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      const ok = await succeeds(action);
      await refresh();
      return ok;
    },
    [refresh],
  );

  const createFolder = useCallback(
    async (name: string) => {
      const folder = await attempt(() => api.createFolder(name));
      await refresh();
      return folder ?? null;
    },
    [refresh],
  );

  return {
    videos,
    folders,
    query,
    updateQuery,
    visibleVideos,
    folderTotal,
    unfiledCount,
    refresh,
    createFolder,
    renameFolder: (id: string, name: string) => mutate(() => api.renameFolder(id, name)),
    deleteFolder: (id: string) => mutate(() => api.deleteFolder(id)),
    moveVideos: (ids: string[], folderId: string | null) =>
      ids.length === 0 ? Promise.resolve(true) : mutate(() => api.moveVideos(ids, folderId)),
    removeVideos: (ids: string[], deleteFile: boolean) =>
      ids.length === 0 ? Promise.resolve(true) : mutate(() => api.removeVideos(ids, deleteFile)),
  };
}
