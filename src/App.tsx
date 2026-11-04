// The window: title-bar tabs, sidebar, and one of Library / Downloads /
// Settings, or the player when a tab is open. State lives in hooks/; this
// file only wires them together.

import { useState } from "react";
import { api } from "./api";
import type { Format, View, Video } from "./types";
import Sidebar from "./components/Sidebar";
import Library, { type LibraryActions } from "./components/Library";
import Downloads from "./components/Downloads";
import Settings from "./components/Settings";
import TabBar from "./components/TabBar";
import Toasts from "./components/Toasts";
import VideoView from "./components/VideoView";
import { useSettings } from "./hooks/useSettings";
import { useLibrary } from "./hooks/useLibrary";
import { useDownloads } from "./hooks/useDownloads";
import { useTabs } from "./hooks/useTabs";
import { usePlayQueue } from "./hooks/usePlayQueue";
import { copyText } from "./lib/clipboard";
import { enqueueMessage } from "./lib/enqueue";
import { attempt, notify, succeeds } from "./lib/notify";
import { nextAfter } from "./lib/playQueue";
import { isActive } from "./lib/queueGroups";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>("library");
  const settings = useSettings();
  const library = useLibrary();
  const downloads = useDownloads(library.refresh);
  const tabs = useTabs(library.videos);
  const playQueue = usePlayQueue(library.videos, library.refresh);

  /** Switching sections always leaves the player. */
  const navigate = (next: View) => {
    setView(next);
    tabs.select(null);
  };

  const submitUrl = async (url: string, format: Format) => {
    const summary = await attempt(() => api.enqueueUrl(url, format));
    if (!summary) return false;
    notify.info(enqueueMessage(summary));
    await Promise.all([library.refresh(), downloads.refresh()]);
    if (summary.is_playlist && summary.queued > 0) navigate("downloads");
    return true;
  };

  const downloadMissing = async (video: Video) => {
    if (await succeeds(() => api.downloadVideo(video.id))) {
      notify.info(`Downloading "${video.title}".`);
      await Promise.all([library.refresh(), downloads.refresh()]);
    }
  };

  const removeVideos = async (ids: string[], deleteFile: boolean) => {
    if (!(await library.removeVideos(ids, deleteFile))) return false;
    playQueue.removeMany(ids);
    tabs.closeMany(ids);
    return true;
  };

  // An explicit queue always wins; otherwise autoplay walks the visible grid.
  // nextAfter keeps a folder's last video from spilling into the rest of the
  // library. Every candidate is checked on disk first: a file can vanish
  // mid-session.
  const playNextOnEnd = async (current: Video) => {
    const queued = await playQueue.takeNext(current.id);
    if (queued) return tabs.advance(queued);
    let candidate = nextAfter(current, library.visibleVideos, library.videos);
    while (candidate) {
      if (await playQueue.verify(candidate)) return tabs.advance(candidate);
      candidate = nextAfter(candidate, library.visibleVideos, library.videos);
    }
  };

  const playQueuedNow = async (video: Video) => {
    playQueue.remove(video.id);
    if (await playQueue.verify(video)) tabs.advance(video);
    else notify.error("That file is gone. It has been removed from the library.");
  };

  const libraryActions: LibraryActions = {
    play: tabs.open,
    download: (video) => void downloadMissing(video),
    playNext: playQueue.playNext,
    queue: playQueue.enqueue,
    reveal: (video) => void attempt(() => api.revealVideo(video.id)),
    copyLink: (video) =>
      void attempt(() => copyText(video.url)).then((done) => done !== undefined && notify.info("Link copied.")),
    move: (id, folderId) => void library.moveVideos([id], folderId),
    remove: (id, deleteFile) => void removeVideos([id], deleteFile),
    createFolder: library.createFolder,
    renameFolder: library.renameFolder,
    deleteFolder: library.deleteFolder,
    moveVideos: library.moveVideos,
    removeVideos,
  };

  const activeVideo = tabs.activeVideo;
  const activeDownloads = downloads.queue.filter((entry) => isActive(entry.status)).length;

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region>
        <TabBar tabs={tabs.tabs} activeId={tabs.activeId} onSelect={tabs.select} onClose={tabs.close} />
        <div className="titlebar-drag" data-tauri-drag-region />
        {tabs.tabs.length === 0 && (
          <span className="titlebar-name" data-tauri-drag-region>
            Yank
          </span>
        )}
      </div>
      <div className="workspace">
        <Sidebar
          view={view}
          onNavigate={navigate}
          activeDownloads={activeDownloads}
          defaultFormat={settings.settings?.default_format ?? "video"}
          onSubmit={submitUrl}
        />
        <main className="content">
          <div className={"content-body" + (activeVideo ? " has-video" : "")}>
            {activeVideo ? (
              <VideoView
                video={activeVideo}
                autoPlay={tabs.autoPlay}
                playSignal={tabs.playSignal}
                queue={playQueue.items}
                onEnded={() => void playNextOnEnd(activeVideo)}
                onPlayQueued={(video) => void playQueuedNow(video)}
                onRemoveFromQueue={playQueue.remove}
                onClearQueue={playQueue.clear}
                onQueueOpened={playQueue.pruneMissing}
              />
            ) : (
              <section>
                <h2>{SECTION_TITLES[view]}</h2>
                {view === "library" && (
                  <Library
                    videos={library.visibleVideos}
                    folderTotal={library.folderTotal}
                    libraryTotal={library.videos.length}
                    unfiled={library.unfiledCount}
                    folders={library.folders}
                    query={library.query}
                    onQueryChange={library.updateQuery}
                    actions={libraryActions}
                  />
                )}
                {view === "downloads" && <Downloads queue={downloads.queue} actions={downloads} />}
                {view === "settings" && settings.settings && (
                  <Settings
                    settings={settings.settings}
                    onUpdate={settings.update}
                    onPickFolder={settings.pickFolder}
                    onPickCookies={settings.pickCookies}
                  />
                )}
              </section>
            )}
          </div>
        </main>
      </div>
      <Toasts />
    </div>
  );
}

const SECTION_TITLES: Record<View, string> = {
  library: "Library",
  downloads: "Downloads",
  settings: "Settings",
};
