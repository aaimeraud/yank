import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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

interface Settings {
  download_dir: string | null;
  default_quality: string | null;
  concurrency: string | null;
  theme: string | null;
}

export default function App() {
  const [view, setView] = useState<View>("library");
  const [videos, setVideos] = useState<Video[]>([]);
  const [settings, setSettings] = useState<Settings>({
    download_dir: null,
    default_quality: null,
    concurrency: null,
    theme: null,
  });

  useEffect(() => {
    (async () => {
      const vs = await invoke<Video[]>("list_videos");
      setVideos(vs);
      const dd = await invoke<string | null>("get_setting", { key: "download_dir" });
      const dq = await invoke<string | null>("get_setting", { key: "default_quality" });
      const cc = await invoke<string | null>("get_setting", { key: "concurrency" });
      const th = await invoke<string | null>("get_setting", { key: "theme" });
      setSettings({ download_dir: dd, default_quality: dq, concurrency: cc, theme: th });
    })();
  }, []);

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
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>
            Library
          </button>
          <button className={view === "downloads" ? "active" : ""} onClick={() => setView("downloads")}>
            Downloads
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Settings
          </button>
        </nav>
      </aside>
      <main className="content">
        {view === "library" && (
          <section>
            <h2>Library</h2>
            {videos.length === 0 ? (
              <p className="empty">No videos yet. Download something to get started.</p>
            ) : (
              <div className="grid">
                {videos.map((v) => (
                  <div key={v.id} className="card">
                    <div className="thumb">{v.source}</div>
                    <div className="title">{v.title}</div>
                    <div className="meta">{v.uploader ?? "Unknown"}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
        {view === "downloads" && (
          <section>
            <h2>Downloads</h2>
            <p className="empty">Queue coming soon.</p>
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
            <div className="setting">
              <label>Default quality</label>
              <span>{settings.default_quality ?? "best (MP4)"}</span>
            </div>
            <div className="setting">
              <label>Concurrency</label>
              <span>{settings.concurrency ?? "2"}</span>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}