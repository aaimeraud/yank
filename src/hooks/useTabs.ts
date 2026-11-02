import { useCallback, useEffect, useState } from "react";
import type { Video } from "../types";
import { advanceTabs } from "../lib/tabs";

export function useTabs(videos: Video[]) {
  const [tabs, setTabs] = useState<Video[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Autoplay has to survive the tab swap: the player reads this once when the
  // new file loads and starts it without asking for a click.
  const [autoPlayId, setAutoPlayId] = useState<string | null>(null);
  // Restarting the video that is already on screen keeps the same id, so the
  // player's per-video effect never re-runs. A counter gives it a signal.
  const [playSignal, setPlaySignal] = useState(0);

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
    setAutoPlayId(null);
  }, []);

  /**
   * Replace the active tab with the video that should follow it. Reusing the
   * tab keeps a playlist from opening one tab per entry, and if the next video
   * is already open elsewhere, that tab is selected instead of duplicated.
   */
  const advance = useCallback(
    (video: Video) => {
      if (!video.file_path) return;
      // "Play now" on the video already on screen: restart it in place.
      if (video.id === activeId) {
        setPlaySignal((signal) => signal + 1);
        return;
      }
      const next = advanceTabs({ tabs, activeId }, video);
      setTabs(next.tabs);
      setActiveId(next.activeId);
      setAutoPlayId(video.id);
    },
    [activeId, tabs],
  );

  const close = useCallback(
    (id: string) => {
      const index = tabs.findIndex((tab) => tab.id === id);
      const remaining = tabs.filter((tab) => tab.id !== id);
      setTabs(remaining);
      setActiveId((current) =>
        current === id ? remaining[Math.min(index, remaining.length - 1)]?.id ?? null : current,
      );
      setAutoPlayId((current) => (current === id ? null : current));
    },
    [tabs],
  );

  const select = useCallback((id: string | null) => {
    setActiveId(id);
    setAutoPlayId(null);
  }, []);

  const activeVideo = tabs.find((tab) => tab.id === activeId) ?? null;

  return {
    tabs,
    activeId,
    activeVideo,
    autoPlay: activeVideo !== null && autoPlayId === activeVideo.id,
    playSignal,
    open,
    advance,
    close,
    select,
  };
}
