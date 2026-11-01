import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { View, Video, QueueItem, Metadata } from "./types";
import Sidebar from "./components/Sidebar";
import Library from "./components/Library";
import Downloads from "./components/Downloads";
import Settings from "./components/Settings";
import Player from "./components/Player";
import "./App.css";

export default function App() {
  const [view, setView] = useState<View>("library");
  const [videos, setVideos] = useState<Video[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [settings, setSettings] = useState({ download_dir: null as string | null });

  const refresh = async () => {
    setVideos(await invoke<Video[]>("list_videos"));
    setQueue(await invoke<QueueItem[]>("list_queue"));
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

  const download = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const entries = await invoke<Metadata[]>("fetch_playlist_entries", { url });
      const isPlaylist = entries.length > 1;
      let playlistId: string | null = null;
      if (isPlaylist) {
        playlistId = crypto.randomUUID();
        await invoke("add_playlist", { playlist: { id: playlistId, title: entries[0].title || "Playlist", source: entries[0].extractor ?? "Other", url, thumbnail_path: entries[0].thumbnail } });
      }
      const metas = isPlaylist ? entries : [await invoke<Metadata>("fetch_metadata", { url })];
      for (const meta of metas) {
        const source = meta.extractor ?? "Other";
        const videoId = meta.id || crypto.randomUUID();
        await invoke("add_video", { video: {
          id: videoId, title: meta.title, uploader: meta.uploader, duration: meta.duration,
          thumbnail_path: null, source, url: meta.webpage_url ?? url, file_path: null,
          file_size: null, downloaded_at: null, last_position: 0, watched: false, playlist_id: playlistId,
        }});
        const dir = settings.download_dir ?? (await invoke<string>("get_setting", { key: "download_dir" })) ?? "";
        if (!dir) { alert("Pick a downloads folder in Settings first."); setBusy(false); return; }
        await invoke("start_download", { videoId, url: meta.webpage_url ?? url, formatPref: "video", downloadDir: dir });
      }
      setUrl("");
      await refresh();
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

  return (
    <div className="app">
      <Sidebar view={view} setView={setView} url={url} setUrl={setUrl} onDownload={download} busy={busy} />
      <main className="content">
        {view === "library" && <section><h2>Library</h2><Library videos={videos} onPlay={setCurrentVideo} /></section>}
        {view === "downloads" && <section><h2>Downloads</h2><Downloads queue={queue} /></section>}
        {view === "settings" && <section><h2>Settings</h2><Settings downloadDir={settings.download_dir} onPickFolder={pickFolder} /></section>}
      </main>
      <Player video={currentVideo} />
    </div>
  );
}