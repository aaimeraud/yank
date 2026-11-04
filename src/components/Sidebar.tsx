import { useState } from "react";
import type { Folder, View } from "../types";
import { ALL, UNFILED } from "../lib/libraryFilter";
import { DownloadsIcon, FolderIcon, LibraryIcon, PlusIcon, SettingsIcon } from "./icons";

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  /** Downloads still running or waiting, shown beside Downloads. */
  activeDownloads: number;
  folders: Folder[];
  /** The folder the library shows; highlighted only while on the Library. */
  selectedFolder: string;
  libraryTotal: number;
  unfiled: number;
  onOpenFolder: (folderId: string) => void;
  onCreateFolder: (name: string) => Promise<Folder | null>;
}

/**
 * Screens at the top, the library's folders under them. The active row is
 * marked by its label brightening, nothing else (true-black-flat style).
 */
export default function Sidebar(props: Props) {
  const { view, onNavigate, folders, selectedFolder, onOpenFolder } = props;
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const inLibrary = view === "library";

  const finishCreate = async () => {
    const name = draft.trim();
    setDraft("");
    setCreating(false);
    if (!name) return;
    const folder = await props.onCreateFolder(name);
    if (folder) onOpenFolder(folder.id);
  };

  const navItem = (target: View, label: string, icon: React.ReactNode, count?: number) => (
    <button
      className={"nav-row" + (view === target ? " active" : "")}
      aria-current={view === target ? "page" : undefined}
      onClick={() => onNavigate(target)}
    >
      {icon}
      <span className="nav-label">{label}</span>
      {count ? (
        <span className="nav-count" aria-label={`${count} active`}>
          {count}
        </span>
      ) : null}
    </button>
  );

  const folderRow = (id: string, label: string, count: number, icon = true) => (
    <button
      key={id}
      className={"nav-row folder-row" + (inLibrary && selectedFolder === id ? " active" : "")}
      aria-current={inLibrary && selectedFolder === id ? "page" : undefined}
      onClick={() => onOpenFolder(id)}
      title={label}
    >
      {icon ? <FolderIcon /> : <span className="nav-spacer" aria-hidden="true" />}
      <span className="nav-label">{label}</span>
      <span className="nav-meta">{count}</span>
    </button>
  );

  return (
    <aside className="sidebar">
      <nav className="nav-group" aria-label="Screens">
        {navItem("library", "Library", <LibraryIcon />)}
        {navItem("downloads", "Downloads", <DownloadsIcon />, props.activeDownloads)}
        {navItem("settings", "Settings", <SettingsIcon />)}
      </nav>

      <nav className="nav-group folders" aria-label="Folders">
        <span className="nav-heading">Folders</span>
        {folderRow(ALL, "All videos", props.libraryTotal, false)}
        {folderRow(UNFILED, "Unfiled", props.unfiled, false)}
        {folders.map((folder) => folderRow(folder.id, folder.name, folder.video_count))}
        {creating ? (
          <input
            className="nav-input"
            autoFocus
            placeholder="Folder name"
            aria-label="New folder name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void finishCreate()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void finishCreate();
              if (event.key === "Escape") {
                setDraft("");
                setCreating(false);
              }
            }}
          />
        ) : (
          <button className="nav-row nav-add" onClick={() => setCreating(true)}>
            <PlusIcon />
            <span className="nav-label">New folder</span>
          </button>
        )}
      </nav>
    </aside>
  );
}
