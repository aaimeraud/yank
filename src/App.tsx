// The window: top bar, sidebar, one screen (Library, YouTube, Downloads,
// Settings or the player), the queue panel on the right, and the player
// itself, which stays alive across screens and shrinks to a mini player when
// you leave it.
// State lives in hooks/; this file only wires it together.

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import type { Format, QueueEntry, SearchResult, View, Video } from "./types";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import Library, { type LibraryActions } from "./components/Library";
import Downloads from "./components/Downloads";
import Settings from "./components/Settings";
import YouTube from "./components/youtube/YouTube";
import type { HitActions } from "./components/youtube/ResultCard";
import QueuePanel from "./components/QueuePanel";
import Toasts from "./components/Toasts";
import QualityPicker from "./components/QualityPicker";
import Player from "./components/player/Player";
import { useSettings } from "./hooks/useSettings";
import { useLibrary } from "./hooks/useLibrary";
import { useDownloads } from "./hooks/useDownloads";
import { usePlayer, type StreamItem } from "./hooks/usePlayer";
import { useYoutube } from "./hooks/useYoutube";
import { copyText } from "./lib/clipboard";
import { enqueueMessage } from "./lib/enqueue";
import { attempt, errorMessage, notify, succeeds } from "./lib/notify";
import { usePref } from "./lib/prefs";
import { isActive, queueHeadline } from "./lib/queueGroups";
import { queuePlacement } from "./lib/queuePlacement";
import { PLAYER_ACTS, createGate, reporting } from "./lib/userActs";
import { downloadBlocker, entryToHit, isLive, isUnavailable, streamTarget, watchBlocker } from "./lib/youtube";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>("library");
  const [sidebarCollapsed, setSidebarCollapsed] = usePref("sidebarCollapsed", false);
  const [queueOpen, setQueueOpen] = usePref("queueOpen", false);
  const settings = useSettings();
  const library = useLibrary();
  const downloads = useDownloads(library.refresh);
  // Play all answers seconds after its click: anything the user does to
  // what plays meanwhile wins (lib/userActs.ts). The player and the
  // YouTube screen report through wrappers, so every caller counts.
  const gate = useRef(createGate()).current;
  const player = reporting(usePlayer(library.videos, library.refresh), PLAYER_ACTS, gate.act);
  const youtube = reporting(useYoutube(), ["openPlaylist"], gate.act);
  // The screen the player was opened from: it stays under the full player,
  // and minimizing goes back to it.
  const [lastScreen, setLastScreen] = useState<Exclude<View, "player">>("library");
  const navigate = (next: View) => {
    if (next !== "player") setLastScreen(next);
    setView(next);
  };

  const playing = player.current;
  // The player screen only exists while something plays.
  const screen: View = view === "player" && !playing ? lastScreen : view;
  const below = screen === "player" ? lastScreen : screen;
  const mode = screen === "player" ? "full" : "mini";
  const libraryById = useMemo(() => new Map(library.videos.map((video) => [video.id, video])), [library.videos]);
  const viewRef = useRef(view);
  viewRef.current = view;
  // Downloads asked for and not answered yet (listing a URL takes seconds):
  // a second click on the same one is ignored instead of listing it again.
  const pendingDownloads = useRef(new Set<string>());
  // The URL whose qualities are on screen, and what to do with the answer.
  const [picking, setPicking] = useState<{ url: string; resolve: (format: Format | null) => void } | null>(null);

  // The player screen with nothing in it (the video left the library):
  // back to where it was opened from, so a later play does not pop it up.
  useEffect(() => {
    if (view === "player" && !playing) setView(lastScreen);
  }, [view, playing, lastScreen]);

  /** Start a video from the grid: what is visible becomes "Next from …". */
  const playFromLibrary = async (video: Video) => {
    // The card of what is already playing just opens the player.
    if (video.id === playing?.id && !player.source.streaming) {
      gate.act();
      navigate("player");
      return;
    }
    const ok = await player.playVideo(video, {
      label: library.title,
      ids: library.visibleVideos.filter((v) => v.file_path).map((v) => v.id),
    });
    if (ok) navigate("player");
    else notify.error("That file is gone. The library has been updated.");
  };

  /** Play from the queue panel: keeps the context autoplay continues in. */
  const playFromPanel = async (video: Video) => {
    if (!(await player.playVideo(video))) notify.error("That file is gone. The library has been updated.");
  };

  /** Queue a URL. A playlist pasted in the top bar shows its downloads; one from the YouTube screen stays put. */
  const submitUrl = async (url: string, format: Format | null, openDownloads = true, fromSearch = false) => {
    if (pendingDownloads.current.has(url)) return false;
    pendingDownloads.current.add(url);
    const summary = await attempt(() => api.enqueueUrl(url, format, fromSearch)).finally(() =>
      pendingDownloads.current.delete(url),
    );
    if (!summary) return false;
    notify.info(enqueueMessage(summary));
    await Promise.all([library.refresh(), downloads.refresh()]);
    if (openDownloads && summary.is_playlist && summary.queued > 0) navigate("downloads");
    return true;
  };

  /** Ask which quality to download; null when the picker was dismissed. */
  const askQuality = (url: string) =>
    // One picker at a time: a second request answers "dismissed" at once,
    // so whoever asked is never left waiting.
    picking
      ? Promise.resolve(null)
      : new Promise<Format | null>((resolve) => {
          setPicking({ url, resolve });
        });

  /** Open the picker for `url` and queue the choice. True when it was queued. */
  const chooseQuality = async (url: string, openDownloads = true, fromSearch = false) => {
    const format = await askQuality(url);
    return format ? submitUrl(url, format, openDownloads, fromSearch) : false;
  };

  /**
   * Watch `hits[index]` from the YouTube screen, the rest of the list
   * following it. Hits already on disk play their file (checked first, as
   * the library does); the others stream (ADR 0010).
   */
  const watchList = (hits: SearchResult[], index: number, label: string, show = true) => {
    const target = hits[index];
    if (!target) return;
    // Upcoming premieres, private and deleted videos have nothing to play;
    // their cards cannot be clicked, and Next skips them.
    const eligible = hits.filter((hit) => hit.kind === "video" && !watchBlocker(hit) && !isUnavailable(hit));
    if (!eligible.includes(target)) return;
    const items: StreamItem[] = eligible.map((hit) => ({ video: streamTarget(hit, libraryById), url: hit.url, live: isLive(hit) }));
    player.playStream(items, eligible.indexOf(target), label);
    if (show) navigate("player");
  };

  const hitActions: HitActions & { watchList: typeof watchList } = {
    watchList,
    open: (hit) => watchList([hit], 0, "YouTube"),
    playAll: (hit) => {
      // Anything the user did to what plays meanwhile (another Play all,
      // opening another playlist) wins; its lookup may even have stopped
      // this one, so no error either. A change of screen does not cancel
      // it: it then starts in the mini player, where the user is.
      const stillWanted = gate.begin();
      const shownFrom = view;
      notify.info(`Opening "${hit.title}"…`);
      api.inspectUrl(hit.url).then((info) => {
        if (!stillWanted()) return;
        const hits = info.entries
          .map(entryToHit)
          .filter((entry): entry is SearchResult => entry !== null && !isUnavailable(entry) && !watchBlocker(entry));
        if (hits.length === 0) notify.error(`"${info.title}" has no videos to play.`);
        else watchList(hits, 0, info.title, viewRef.current === shownFrom);
      }, (error) => stillWanted() && notify.error(errorMessage(error)));
    },
    download: (hit, format) => {
      const blocked = downloadBlocker(hit);
      if (blocked) notify.error(blocked);
      else void submitUrl(hit.url, format, false, true);
    },
    chooseQuality: (hit) => {
      const blocked = downloadBlocker(hit);
      if (blocked) notify.error(blocked);
      else void chooseQuality(hit.url, false, true);
    },
    copyLink: (hit) =>
      void attempt(() => copyText(hit.url)).then((done) => done !== undefined && notify.info("Link copied.")),
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
    navigate("library");
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
  const queueAt = queuePlacement(queueOpen, mode, Boolean(playing));
  if (queueAt === "side") classes.push("queue-open");
  const closeQueue = () => setQueueOpen(false);
  const queuePanel = <QueuePanel player={player} onClose={closeQueue} onPlay={(video) => void playFromPanel(video)} />;
  // Live and already-kept videos have nothing to download.
  const canDownloadPlaying =
    playing !== null &&
    player.source.streaming &&
    // Live is only certain once the lookup answered.
    !player.source.loading &&
    !player.source.error &&
    !player.source.isLive &&
    !downloadsByVideo.has(playing.id) &&
    !libraryById.get(playing.id)?.file_path;

  return (
    <div className={classes.join(" ")}>
      <TopBar
        queue={downloads.queue}
        defaultFormat={settings.settings?.default_format ?? null}
        onSubmit={submitUrl}
        onChooseQuality={(url) => chooseQuality(url)}
        onOpenDownloads={() => navigate("downloads")}
      />
      <div className="workspace">
        <Sidebar
          view={screen}
          onNavigate={navigate}
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
            <section className="screen" key={below}>
              {below === "library" && (
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
              {below === "youtube" && (
                <YouTube
                  youtube={youtube}
                  library={libraryById}
                  downloads={downloadsByVideo}
                  playingId={playing?.id ?? null}
                  actions={hitActions}
                />
              )}
              {below === "downloads" && (
                <>
                  <ScreenHead title="Downloads" sub={queueHeadline(downloads.queue)} />
                  <Downloads queue={downloads.queue} actions={downloads} />
                </>
              )}
              {below === "settings" && settings.settings && (
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
              source={player.source}
              mode={mode}
              startToken={player.startToken}
              nextVideo={player.nextVideo}
              canPrevious={player.canPrevious}
              autoplay={player.autoplay}
              repeat={player.repeat}
              queueOpen={queueOpen}
              onEnded={() => void player.onEnded()}
              onSaved={(id, position, watched) => {
                library.patchPlayback(id, position, watched);
                player.notePlayback(id, position, watched);
              }}
              onNext={() => void player.goNext()}
              onPrevious={() => {
                void player.goPrevious().then((ok) => {
                  if (!ok && player.canPrevious && !player.stream) notify.error("The previous video's file is gone.");
                });
              }}
              onToggleAutoplay={() => player.setAutoplay((value) => !value)}
              onToggleRepeat={() => player.setRepeat((value) => !value)}
              onToggleQueue={() => setQueueOpen((value) => !value)}
              onExpand={() => navigate("player")}
              onMinimize={() => navigate(lastScreen)}
              onClose={() => {
                player.stop();
                // Closing never leaves the full player waiting to reopen.
                if (view === "player") navigate(lastScreen);
              }}
              onReveal={() => void attempt(() => api.revealVideo(playing.id))}
              onOpenExternally={() => void attempt(() => api.openVideoExternally(playing.id))}
              onCopyLink={() => copyLink(playing)}
              onDownload={canDownloadPlaying ? () => void submitUrl(playing.url, null, false, true) : null}
              onChooseQuality={canDownloadPlaying ? () => void chooseQuality(playing.url, false, true) : null}
              miniQueue={queueAt === "mini" ? queuePanel : null}
              onRetryStream={player.retryStream}
              onStreamFailed={player.streamFailed}
            />
          )}
        </main>
        {queueAt === "side" && queuePanel}
      </div>
      <Toasts />
      {picking && (
        <QualityPicker
          url={picking.url}
          onPick={(format) => {
            picking.resolve(format);
            setPicking(null);
          }}
          onCancel={() => {
            picking.resolve(null);
            setPicking(null);
          }}
        />
      )}
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
