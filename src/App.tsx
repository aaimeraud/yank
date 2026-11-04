// The window: title-bar tabs, sidebar, and one of Library / Downloads /
// Settings, or the player when a tab is open. State lives in hooks/; this
// file only wires them together.

import { useMemo, useState } from "react";
import { api } from "./api";
import type { Format, QueueEntry, View, Video } from "./types";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
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
import { isActive, queueHeadline } from "./lib/queueGroups";
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

  const openFolder = (folder: string) => {
    library.updateQuery({ folder });
    navigate("library");
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
    renameFolder: library.renameFolder,
    deleteFolder: library.deleteFolder,
    moveVideos: library.moveVideos,
    removeVideos,
  };

  const activeVideo = tabs.activeVideo;
  const activeDownloads = downloads.queue.filter((entry) => isActive(entry.status)).length;
  // Active rows by video, so library cards can show their download live.
  const downloadsByVideo = useMemo(() => {
    const map = new Map<string, QueueEntry>();
    for (const entry of downloads.queue) if (isActive(entry.status)) map.set(entry.video_id, entry);
    return map;
  }, [downloads.queue]);

  return (
    <div className="app">
      <TopBar
        queue={downloads.queue}
        defaultFormat={settings.settings?.default_format ?? "video"}
        onSubmit={submitUrl}
        onOpenDownloads={() => navigate("downloads")}
      />
      <div className="workspace">
        <Sidebar
          view={activeVideo ? "library" : view}
          onNavigate={navigate}
          activeDownloads={activeDownloads}
          folders={library.folders}
          selectedFolder={library.query.folder}
          libraryTotal={library.videos.length}
          unfiled={library.unfiledCount}
          onOpenFolder={openFolder}
          onCreateFolder={library.createFolder}
        />
        <main className="content">
          <TabBar tabs={tabs.tabs} activeId={tabs.activeId} onSelect={tabs.select} onClose={tabs.close} />
          <div className={"canvas" + (activeVideo ? " has-video" : "")}>
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
              <section className="screen" key={view}>
                {view === "library" && (
                  <Library
                    videos={library.visibleVideos}
                    folderVideos={library.folderVideos}
                    libraryTotal={library.videos.length}
                    folders={library.folders}
                    downloads={downloadsByVideo}
                    query={library.query}
                    onQueryChange={library.updateQuery}
                    actions={libraryActions}
                  />
                )}
                {view === "downloads" && (
                  <>
                    <ScreenHead title="Downloads" sub={queueHeadline(downloads.queue)} />
                    <Downloads queue={downloads.queue} actions={downloads} />
                  </>
                )}
                {view === "settings" && settings.settings && (
                  <>
                    <ScreenHead title="Settings" sub="Where downloads go, what they look like, and the tools behind them." />
                    <Settings
                      settings={settings.settings}
                      onUpdate={settings.update}
                      onPickFolder={settings.pickFolder}
                      onPickCookies={settings.pickCookies}
                    />
                  </>
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

function ScreenHead({ title, sub }: { title: string; sub: string }) {
  return (
    <header className="screen-head">
      <div className="screen-titles">
        <h1 className="screen-title">{title}</h1>
        <p className="screen-sub">{sub}</p>
      </div>
    </header>
  );
}
