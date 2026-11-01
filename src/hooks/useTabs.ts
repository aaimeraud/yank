import { useCallback, useEffect, useState } from "react";
import type { Video } from "../types";

export function useTabs(videos: Video[]) {
  const [tabs, setTabs] = useState<Video[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // A finished download or a refreshed library row should update the open tab,
  // without dropping tabs whose video was removed.
  useEffect(() => {
    setTabs((current) => current.map((tab) => videos.find((v) => v.id === tab.id) ?? tab));
  }, [videos]);

  const open = useCallback((video: Video) => {
    if (!video.file_path) return;
    setTabs((current) =>
      current.some((tab) => tab.id === video.id)
        ? current.map((tab) => (tab.id === video.id ? video : tab))
        : [...current, video],
    );
    setActiveId(video.id);
  }, []);

  const close = useCallback(
    (id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id);
      const remaining = tabs.filter((tab) => tab.id !== id);
      setTabs(remaining);
      setActiveId((current) =>
        current === id ? remaining[Math.min(index, remaining.length - 1)]?.id ?? null : current,
      );
    },
    [tabs],
  );

  const activeVideo = tabs.find((tab) => tab.id === activeId) ?? null;

  return { tabs, activeId, activeVideo, open, close, select: setActiveId };
}
