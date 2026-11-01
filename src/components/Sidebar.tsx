import type { View } from "../types";

interface Props {
  view: View;
  setView: (v: View) => void;
  url: string;
  setUrl: (u: string) => void;
  onDownload: () => void;
  busy: boolean;
}

export default function Sidebar({ view, setView, url, setUrl, onDownload, busy }: Props) {
  return (
    <aside className="sidebar">
      <h1 className="logo">Yank</h1>
      <nav>
        <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>Library</button>
        <button className={view === "downloads" ? "active" : ""} onClick={() => setView("downloads")}>Downloads</button>
        <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
      </nav>
      <div className="urlbox">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste URL…" onKeyDown={(e) => e.key === "Enter" && onDownload()} />
        <button onClick={onDownload} disabled={busy}>{busy ? "…" : "Download"}</button>
      </div>
    </aside>
  );
}