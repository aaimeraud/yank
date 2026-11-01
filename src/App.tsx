import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

type View = "library" | "downloads" | "settings";

interface Video {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail_path: string | null;
  source: string;
  url: string;
  file_path: string | null;
  watched: boolean;
}

interface QueueItem {
  id: string;
  video_id: string | null;
  status: string;
  progress: number;
  speed: string | null;
  eta: string | null;
  error: string | null;
  created_at: number;
}

interface Metadata {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  extractor: string | null;
  webpage_url: string | null;
}

export default function App() {
  const [view, setView] = useState<View>("library");
  const [videos, setVideos] = useState<Video[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState("");
  const [settings, setSettings] = useState({ download_dir: null as string | null, default_quality: null as string | null });

  const refresh = async () => {
    setVideos(await invoke<Video[]>("list_videos"));
    setQueue(await invoke<QueueItem[]>("list_queue"));
  };

  useEffect(() => {
    refresh();
    (async () => {
      const dd = await invoke<string | null>("get_setting", { key: "download_dir" });
      const dq = await invoke<string | null>("get_setting", { key: "default_quality" });
      setSettings({ download_dir: dd, default_quality: dq });
    })();
    const unlisten = listen<any>("download-progress", (e) => {
      const p = e.payload;
      setQueue((q) => q.map((item) => item.id === p.queue_id ? { ...item, status: p.status, progress: p.progress ?? item.progress, speed: p.speed ?? item.speed, eta: p.eta ?? item.eta, error: p.error ?? item.error } : item));
      if (p.status === "done") refresh();
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  const playVideo = (v: Video) => {
    if (!v.file_path) return;
    setCurrentVideo(v);
    setPlaying(true);
  };

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) { el.play(); setPlaying(true); } else { el.pause(); setPlaying(false); }
  };

  const download = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const meta = await invoke<Metadata>("fetch_metadata", { url });
      const source = meta.extractor ?? "Other";
      const videoId = meta.id || crypto.randomUUID();
      await invoke("add_video", { video: {
        id: videoId, title: meta.title, uploader: meta.uploader, duration: meta.duration,
        thumbnail_path: null, source, url: meta.webpage_url ?? url, file_path: null,
        file_size: null, downloaded_at: null, last_position: 0, watched: false, playlist_id: null,
      }});
      const dir = settings.download_dir ?? (await invoke<string>("get_setting", { key: "download_dir" })) ?? "";
      if (!dir) { alert("Pick a downloads folder in Settings first."); setBusy(false); return; }
      await invoke("start_download", { videoId, url, formatPref: "video", downloadDir: dir });
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
      setSettings((s) => ({ ...s, download_dir: folder }));
    }
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <h1 className="logo">Yank</h1>
        <nav>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>Library</button>
          <button className={view === "downloads" ? "active" : ""} onClick={() => setView("downloads")}>Downloads</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
        </nav>
        <div className="urlbox">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste URL…" onKeyDown={(e) => e.key === "Enter" && download()} />
          <button onClick={download} disabled={busy}>{busy ? "…" : "Download"}</button>
        </div>
      </aside>
      <main className="content">
        {view === "library" && (
          <section>
            <h2>Library</h2>
            {videos.length === 0 ? <p className="empty">No videos yet.</p> : (
              <div className="grid">
                {videos.map((v) => (
                  <div key={v.id} className="card" onClick={() => playVideo(v)} style={{ cursor: v.file_path ? "pointer" : "default" }}>
                    <div className="thumb">{v.source}</div>
                    <div className="title">{v.title}</div>
                    <div className="meta">{v.uploader ?? "Unknown"}{v.watched ? " • watched" : ""}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {view === "downloads" && (
          <section>
            <h2>Downloads</h2>
            {queue.length === 0 ? <p className="empty">No downloads.</p> : (
              <ul className="queue">
                {queue.map((q) => (
                  <li key={q.id}>
                    <span>{q.status}</span>
                    <progress value={q.progress} max={100} />
                    <span>{q.progress.toFixed(0)}%</span>
                    {q.speed && <span className="muted">{q.speed}</span>}
                    {q.error && <span className="err">{q.error}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {view === "settings" && (
          <section>
            <h2>Settings</h2>
            <div className="setting">
              <label>Downloads folder</label>
              <div className="row">
                <span>{settings.download_dir ?? "Not set"}</span>
                <button onClick={pickFolder}>Choose…</button>
              </div>
            </div>
          </section>
        )}
      </main>
      {currentVideo && currentVideo.file_path && (
        <div className="playerbar">
          <video ref={videoRef} src={convertFileSrc(currentVideo.file_path)} autoPlay={playing} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          <div className="playercontrols">
            <button onClick={togglePlay}>{playing ? "Pause" : "Play"}</button>
            <span className="playertitle">{currentVideo.title}</span>
          </div>
        </div>
      )}
    </div>
  );
}