import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { View, Video } from "./types";
import Sidebar from "./components/Sidebar";
import Library from "./components/Library";
import Downloads from "./components/Downloads";
import Settings from "./components/Settings";
import TabBar from "./components/TabBar";
import VideoView from "./components/VideoView";
import { useSettings } from "./hooks/useSettings";
import { useLibrary } from "./hooks/useLibrary";
import { useDownloads } from "./hooks/useDownloads";
import { useTabs } from "./hooks/useTabs";
import { useDownloader } from "./hooks/useDownloader";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>("library");
  const settings = useSettings();
  const library = useLibrary();
  const downloads = useDownloads(library.refresh);
  const tabs = useTabs(library.videos);

  const downloader = useDownloader({
    videos: library.videos,
    queue: downloads.queue,
    downloadDir: settings.settings.download_dir,
    formatPref: settings.settings.default_quality,
    onQueued: async (isPlaylist) => {
      await Promise.all([library.refresh(), downloads.refresh()]);
      if (isPlaylist) {
        setView("downloads");
        tabs.select(null);
      }
    },
  });

  const navigate = (next: View) => {
    setView(next);
    tabs.select(null);
  };

  const removeVideo = async (videoId: string, deleteFile: boolean) => {
    if (await library.removeVideo(videoId, deleteFile)) tabs.close(videoId);
  };

  const downloadMissing = async (video: Video) => {
    const dir =
      settings.settings.download_dir ??
      (await invoke<string | null>("get_setting", { key: "download_dir" })) ??
      "";
    if (!dir) {
      alert("Pick a downloads folder in Settings first.");
      return;
    }
    try {
      await invoke("start_download", {
        videoId: video.id,
        url: video.url,
        formatPref: settings.settings.default_quality,
        downloadDir: dir,
      });
      setView("downloads");
      tabs.select(null);
      await Promise.all([library.refresh(), downloads.refresh()]);
    } catch (e) {
      alert(String(e));
    }
  };

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region>
        <TabBar
          tabs={tabs.tabs}
          activeId={tabs.activeId}
          onSelect={tabs.select}
          onClose={tabs.close}
        />
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
          setView={navigate}
          url={downloader.url}
          setUrl={downloader.setUrl}
          onDownload={downloader.submit}
          busy={downloader.busy}
        />
        <main className="content">
          <div className={"content-body" + (tabs.activeVideo ? " has-video" : "")}>
            {tabs.activeVideo ? (
              <VideoView video={tabs.activeVideo} />
            ) : (
              <>
                {view === "library" && (
                  <section>
                    <h2>Library</h2>
                    <Library
                      videos={library.videos}
                      folders={library.folders}
                      onPlay={tabs.open}
                      onDownload={downloadMissing}
                      onCreateFolder={library.createFolder}
                      onRenameFolder={library.renameFolder}
                      onDeleteFolder={library.deleteFolder}
                      onMoveVideo={library.moveVideo}
                      onRemoveVideo={removeVideo}
                    />
                  </section>
                )}
                {view === "downloads" && (
                  <section>
                    <h2>Downloads</h2>
                    <Downloads
                      queue={downloads.queue}
                      videos={library.videos}
                      onPause={downloads.pause}
                      onResume={(id) =>
                        downloads.resume(
                          id,
                          settings.settings.default_quality,
                          settings.settings.download_dir,
                        )
                      }
                      onCancel={downloads.cancel}
                      onRemove={downloads.remove}
                      onClearFinished={downloads.clearFinished}
                    />
                  </section>
                )}
                {view === "settings" && (
                  <section>
                    <h2>Settings</h2>
                    <Settings
                      settings={settings.settings}
                      onUpdate={settings.update}
                      onPickFolder={settings.pickFolder}
                      onPickCookies={settings.pickCookies}
                    />
                  </section>
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
