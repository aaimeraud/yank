// The window: top bar, sidebar, one screen (Library, Downloads, Settings or
// the player), the queue panel on the right, and the player itself, which
// stays alive across screens and shrinks to a mini player when you leave it.
// State lives in hooks/; this file only wires it together.

import { useMemo, useState } from "react";
import { api } from "./api";
import type { Format, QueueEntry, View, Video } from "./types";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Library, { type LibraryActions } from "./components/Library";
import Downloads from "./components/Downloads";
import Settings from "./components/Settings";
import QueuePanel from "./components/QueuePanel";
import Toasts from "./components/Toasts";
import Player from "./components/player/Player";
import { useSettings } from "./hooks/useSettings";
import { useLibrary } from "./hooks/useLibrary";
import { useDownloads } from "./hooks/useDownloads";
import { usePlayer } from "./hooks/usePlayer";
import { copyText } from "./lib/clipboard";
import { enqueueMessage } from "./lib/enqueue";
import { attempt, notify, succeeds } from "./lib/notify";
import { usePref } from "./lib/prefs";
import { isActive, queueHeadline } from "./lib/queueGroups";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>("library");
  const [sidebarCollapsed, setSidebarCollapsed] = usePref("sidebarCollapsed", false);
  const [queueOpen, setQueueOpen] = usePref("queueOpen", false);
  const settings = useSettings();
  const library = useLibrary();
  const downloads = useDownloads(library.refresh);
  const player = usePlayer(library.videos, library.refresh);

  const playing = player.current;
  // The player screen only exists while something plays.
  const screen: View = view === "player" && !playing ? "library" : view;
  const mode = screen === "player" ? "full" : "mini";

  /** Start a video from the grid: what is visible becomes "Next from …". */
  const playFromLibrary = async (video: Video) => {
    // The card of what is already playing just opens the player.
    if (video.id === playing?.id) {
      setView("player");
      return;
    }
    const ok = await player.playVideo(video, {
      label: library.title,
      ids: library.visibleVideos.filter((v) => v.file_path).map((v) => v.id),
    });
    if (ok) setView("player");
    else notify.error("That file is gone. The library has been updated.");
  };

  /** Play from the queue panel: keeps the context autoplay continues in. */
  const playFromPanel = async (video: Video) => {
    if (!(await player.playVideo(video))) notify.error("That file is gone. The library has been updated.");
  };

  const submitUrl = async (url: string, format: Format) => {
    const summary = await attempt(() => api.enqueueUrl(url, format));
    if (!summary) return false;
    notify.info(enqueueMessage(summary));
    await Promise.all([library.refresh(), downloads.refresh()]);
    if (summary.is_playlist && summary.queued > 0) setView("downloads");
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
    player.forget(ids);
    return true;
  };

  const copyLink = (video: Video) =>
    void attempt(() => copyText(video.url)).then((done) => done !== undefined && notify.info("Link copied."));

  const libraryActions: LibraryActions = {
    play: (video) => void playFromLibrary(video),
    download: (video) => void downloadMissing(video),
    playNext: (video) => {
      player.playNext(video);
      notify.info(`"${video.title}" plays next.`);
    },
    queue: (video) => {
      player.enqueue(video);
      notify.info(`Added "${video.title}" to the queue.`);
    },
    reveal: (video) => void attempt(() => api.revealVideo(video.id)),
    copyLink,
    move: (id, folderId) => void library.moveVideos([id], folderId),
    remove: (id, deleteFile) => void removeVideos([id], deleteFile),
    renameFolder: library.renameFolder,
    deleteFolder: library.deleteFolder,
    moveVideos: library.moveVideos,
    removeVideos,
  };

  const openFolder = (folder: string) => {
    library.updateQuery({ folder });
    setView("library");
  };

  // Active rows by video, so library cards can show their download live.
  const { downloadsByVideo, activeDownloads } = useMemo(() => {
    const map = new Map<string, QueueEntry>();
    let active = 0;
    for (const entry of downloads.queue) {
      if (!isActive(entry.status)) continue;
      map.set(entry.video_id, entry);
      active += 1;
    }
    return { downloadsByVideo: map, activeDownloads: active };
  }, [downloads.queue]);

  const classes = ["app"];
  if (sidebarCollapsed) classes.push("sidebar-collapsed");
  if (playing && mode === "mini") classes.push("has-mini");
  if (queueOpen) classes.push("queue-open");

  return (
    <div className={classes.join(" ")}>
      <TopBar
        queue={downloads.queue}
        defaultFormat={settings.settings?.default_format ?? "video"}
        onSubmit={submitUrl}
        onOpenDownloads={() => setView("downloads")}
      />
      <div className="workspace">
        <Sidebar
          view={screen}
          onNavigate={setView}
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed((value) => !value)}
          nowPlaying={playing}
          activeDownloads={activeDownloads}
          folders={library.folders}
          selectedFolder={library.query.folder}
          libraryTotal={library.videos.length}
          unfiled={library.unfiledCount}
          onOpenFolder={openFolder}
          onCreateFolder={library.createFolder}
        />
        <main className="content">
          {/* The screens stay mounted under the full player, so the library
              keeps its scroll position; `inert` keeps them out of reach. */}
          <div className="canvas" inert={mode === "full" && playing ? true : undefined}>
            <section className="screen" key={screen === "player" ? "library" : screen}>
              {(screen === "library" || screen === "player") && (
                <Library
                  title={library.title}
                  videos={library.visibleVideos}
                  folderVideos={library.folderVideos}
                  libraryTotal={library.videos.length}
                  folders={library.folders}
                  downloads={downloadsByVideo}
                  playingId={playing?.id ?? null}
                  query={library.query}
                  onQueryChange={library.updateQuery}
                  actions={libraryActions}
                />
              )}
              {screen === "downloads" && (
                <>
                  <ScreenHead title="Downloads" sub={queueHeadline(downloads.queue)} />
                  <Downloads queue={downloads.queue} actions={downloads} />
                </>
              )}
              {screen === "settings" && settings.settings && (
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
          </div>
          {playing && (
            <Player
              video={playing}
              mode={mode}
              startToken={player.startToken}
              nextVideo={player.nextVideo}
              canPrevious={player.canPrevious}
              autoplay={player.autoplay}
              repeat={player.repeat}
              queueOpen={queueOpen}
              onEnded={() => void player.onEnded()}
              onSaved={library.patchPlayback}
              onNext={() => void player.goNext()}
              onPrevious={() =>
                void player.goPrevious().then((ok) => {
                  if (!ok && player.canPrevious) notify.error("The previous video's file is gone.");
                })
              }
              onToggleAutoplay={() => player.setAutoplay((value) => !value)}
              onToggleRepeat={() => player.setRepeat((value) => !value)}
              onToggleQueue={() => setQueueOpen((value) => !value)}
              onExpand={() => setView("player")}
              onMinimize={() => setView("library")}
              onClose={() => {
                player.stop();
                // Closing never leaves the full player waiting to reopen.
                if (view === "player") setView("library");
              }}
              onReveal={() => void attempt(() => api.revealVideo(playing.id))}
              onCopyLink={() => copyLink(playing)}
            />
          )}
        </main>
        {queueOpen && (
          <QueuePanel player={player} onClose={() => setQueueOpen(false)} onPlay={(video) => void playFromPanel(video)} />
        )}
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
