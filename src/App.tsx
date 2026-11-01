import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { View, Video, QueueItem, Metadata, PlaylistInfo } from "./types";
import Sidebar from "./components/Sidebar";
import Library from "./components/Library";
import Downloads from "./components/Downloads";
import Settings from "./components/Settings";
import TabBar from "./components/TabBar";
import VideoView from "./components/VideoView";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>("library");
  const [videos, setVideos] = useState<Video[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [tabs, setTabs] = useState<Video[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [settings, setSettings] = useState({ download_dir: null as string | null });

  const refresh = async () => {
    const [vs, qs] = await Promise.all([
      invoke<Video[]>("list_videos"),
      invoke<QueueItem[]>("list_queue"),
    ]);
    setVideos(vs);
    setQueue(qs);
    setTabs((prev) => prev.map((t) => vs.find((v) => v.id === t.id) ?? t));
  };

  useEffect(() => {
    refresh();
    invoke<string | null>("get_setting", { key: "download_dir" }).then((dd) => setSettings({ download_dir: dd }));
    const unlisten = listen<any>("download-progress", (e) => {
      const p = e.payload;
      setQueue((q) => q.map((item) => item.id === p.queue_id ? { ...item, status: p.status, progress: p.progress ?? item.progress, speed: p.speed ?? item.speed, eta: p.eta ?? item.eta, error: p.error ?? item.error } : item));
      if (p.status === "done") refresh();
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const navigate = (v: View) => {
    setView(v);
    setActiveTabId(null);
  };

  const openVideo = (v: Video) => {
    if (!v.file_path) return;
    setTabs((prev) => prev.some((t) => t.id === v.id) ? prev.map((t) => t.id === v.id ? v : t) : [...prev, v]);
    setActiveTabId(v.id);
  };

  const closeTab = (id: string) => {
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeTabId === id) {
      setActiveTabId(next[Math.min(idx, next.length - 1)]?.id ?? null);
    }
  };

  const download = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const info = await invoke<PlaylistInfo>("fetch_playlist_info", { url });
      if (info.is_playlist && info.entries.length === 0) {
        alert("This playlist is empty or private.");
        return;
      }
      const metas = info.entries.length ? info.entries : [await invoke<Metadata>("fetch_metadata", { url })];
      const dir = settings.download_dir ?? (await invoke<string | null>("get_setting", { key: "download_dir" })) ?? "";
      if (!dir) {
        alert("Pick a downloads folder in Settings first.");
        return;
      }

      let playlistId: string | null = null;
      if (info.is_playlist) {
        const first = metas[0];
        playlistId = await invoke<string>("add_playlist", {
          playlist: {
            id: crypto.randomUUID(),
            title: info.title || "Playlist",
            source: first?.extractor ?? "Other",
            url,
            thumbnail_path: first?.thumbnail ?? null,
          },
        });
      }

      let queued = 0;
      for (const meta of metas) {
        const target = meta.webpage_url;
        if (!target) continue;
        const videoId = meta.id || crypto.randomUUID();
        const existing = videos.find((v) => v.id === videoId);
        const inFlight = queue.some(
          (q) => q.video_id === videoId && (q.status === "queued" || q.status === "downloading" || q.status === "paused"),
        );
        if (existing?.file_path || inFlight) continue;
        await invoke("add_video", { video: {
          id: videoId, title: meta.title, uploader: meta.uploader, duration: meta.duration,
          thumbnail_path: null, source: meta.extractor ?? "Other", url: target, file_path: null,
          file_size: null, downloaded_at: null, last_position: 0, watched: false, playlist_id: playlistId,
        }});
        await invoke("start_download", { videoId, url: target, formatPref: "video", downloadDir: dir });
        queued += 1;
      }

      setUrl("");
      await refresh();
      if (info.is_playlist) {
        setView("downloads");
        setActiveTabId(null);
      }
      if (queued === 0) alert("Everything in this playlist is already downloaded.");
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    const folder = await invoke<string | null>("pick_folder");
    if (folder) {
      await invoke("set_setting", { key: "download_dir", value: folder });
      setSettings({ download_dir: folder });
    }
  };

  const activeVideo = tabs.find((t) => t.id === activeTabId) ?? null;

  return (
    <div className="app">
      <div className="titlebar" data-tauri-drag-region>
        <TabBar tabs={tabs} activeId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} />
        <div className="titlebar-drag" data-tauri-drag-region />
        {tabs.length === 0 && <span className="titlebar-name" data-tauri-drag-region>Yank</span>}
      </div>
      <div className="workspace">
        <Sidebar view={view} setView={navigate} url={url} setUrl={setUrl} onDownload={download} busy={busy} />
        <main className="content">
          <div className={"content-body" + (activeVideo ? " has-video" : "")}>
            {activeVideo ? (
              <VideoView video={activeVideo} />
            ) : (
              <>
                {view === "library" && <section><h2>Library</h2><Library videos={videos} onPlay={openVideo} /></section>}
                {view === "downloads" && <section><h2>Downloads</h2><Downloads queue={queue} videos={videos} onRefresh={refresh} downloadDir={settings.download_dir} /></section>}
                {view === "settings" && <section><h2>Settings</h2><Settings downloadDir={settings.download_dir} onPickFolder={pickFolder} /></section>}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
