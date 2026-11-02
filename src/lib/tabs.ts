import type { Video } from "../types";

export interface TabState {
  tabs: Video[];
  activeId: string | null;
}

/**
 * Move the player on to the next video by replacing the active tab. Reusing
 * the tab is what keeps a playlist from opening one tab per entry; if the next
 * video is already open elsewhere, that tab is selected and the old one drops.
 */
export function advanceTabs({ tabs, activeId }: TabState, video: Video): TabState {
  if (!video.file_path) return { tabs, activeId };

  const index = tabs.findIndex((tab) => tab.id === activeId);
  if (index === -1) {
    const open = tabs.some((tab) => tab.id === video.id);
    return {
      tabs: open
        ? tabs.map((tab) => (tab.id === video.id ? video : tab))
        : [...tabs, video],
      activeId: video.id,
    };
  }

  const existing = tabs.findIndex((tab) => tab.id === video.id);
  if (existing !== -1 && existing !== index) {
    return { tabs: tabs.filter((_, i) => i !== index), activeId: video.id };
  }

  return {
    tabs: tabs.map((tab, i) => (i === index ? video : tab)),
    activeId: video.id,
  };
}
