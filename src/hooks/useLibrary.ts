import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Video } from "../types";

export function useLibrary() {
  const [videos, setVideos] = useState<Video[]>([]);

  const refresh = useCallback(async () => {
    setVideos(await invoke<Video[]>("list_videos"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { videos, refresh };
}
