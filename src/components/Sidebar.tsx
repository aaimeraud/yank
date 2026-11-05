import { useState } from "react";
import type { Folder, Video, View } from "../types";
import { displayTitle } from "../lib/display";
import { ALL, UNFILED } from "../lib/libraryFilter";
import { DownloadsIcon, FolderIcon, LibraryIcon, PlusIcon, SettingsIcon, SidebarIcon } from "./icons";

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  /** Icons only, labels in tooltips. Remembered across launches. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** The video in the player; its row opens the full player. */
  nowPlaying: Video | null;
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
      title={props.collapsed ? label : undefined}
      aria-label={props.collapsed ? (count ? `${label}, ${count} active` : label) : undefined}
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
      aria-label={props.collapsed ? `${label}, ${count} videos` : undefined}
    >
      {icon ? <FolderIcon /> : <span className="nav-initial" aria-hidden="true">{label.charAt(0)}</span>}
      <span className="nav-label">{label}</span>
      <span className="nav-meta">{count}</span>
    </button>
  );

  return (
    <aside className={"sidebar" + (props.collapsed ? " collapsed" : "")}>
      <nav className="nav-group" aria-label="Screens">
        {navItem("library", "Library", <LibraryIcon />)}
        {navItem("downloads", "Downloads", <DownloadsIcon />, props.activeDownloads)}
        {navItem("settings", "Settings", <SettingsIcon />)}
        {props.nowPlaying &&
          navItem(
            "player",
            props.collapsed ? "Now playing" : displayTitle(props.nowPlaying),
            <span className="eq" aria-hidden="true"><i /><i /><i /></span>,
          )}
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
          <button
            className="nav-row nav-add"
            onClick={() => {
              if (props.collapsed) props.onToggleCollapsed();
              setCreating(true);
            }}
            title={props.collapsed ? "New folder" : undefined}
            aria-label={props.collapsed ? "New folder" : undefined}
          >
            <PlusIcon />
            <span className="nav-label">New folder</span>
          </button>
        )}
      </nav>

      <button
        className="nav-row sidebar-toggle"
        onClick={props.onToggleCollapsed}
        aria-label={props.collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
        aria-expanded={!props.collapsed}
        title={props.collapsed ? "Expand the sidebar" : "Collapse the sidebar"}
      >
        <SidebarIcon />
        <span className="nav-label">Collapse</span>
      </button>
    </aside>
  );
}
