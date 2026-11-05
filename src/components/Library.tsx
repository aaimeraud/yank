import { useEffect, useRef, useState } from "react";
import type { Folder, QueueEntry, Video } from "../types";
import { ALL, UNFILED } from "../lib/libraryFilter";
import { isFiltered, sourceCounts, totalDuration, type LibraryQuery } from "../lib/libraryView";
import { confirmAction } from "../lib/confirm";
import { formatLongDuration, plural } from "../lib/format";
import LibraryToolbar from "./LibraryToolbar";
import VideoCard, { type CardActions } from "./VideoCard";

/** Folder and bulk operations; each resolves to false when it failed. */
export interface LibraryActions extends CardActions {
  renameFolder: (id: string, name: string) => Promise<unknown>;
  deleteFolder: (id: string) => Promise<unknown>;
  moveVideos: (videoIds: string[], folderId: string | null) => Promise<boolean>;
  removeVideos: (videoIds: string[], deleteFile: boolean) => Promise<boolean>;
}

interface Props {
  /** Already filtered and sorted (see lib/libraryView.ts). */
  videos: Video[];
  /** The current folder before search and filters. */
  folderVideos: Video[];
  libraryTotal: number;
  folders: Folder[];
  /** Active queue rows by video id, for live progress on the cards. */
  downloads: Map<string, QueueEntry>;
  /** The video in the player, marked on its card. */
  playingId: string | null;
  query: LibraryQuery;
  onQueryChange: (patch: Partial<LibraryQuery>) => void;
  actions: LibraryActions;
}

export default function Library(props: Props) {
  const { videos, folderVideos, folders, query, actions } = props;
  const selection = useSelection(videos, query.folder);
  const activeFolder = folders.find((folder) => folder.id === query.folder) ?? null;
  const title = activeFolder?.name ?? (query.folder === UNFILED ? "Unfiled" : "All videos");

  return (
    <>
      <LibraryHeader
        title={title}
        folderVideos={folderVideos}
        downloading={folderVideos.filter((video) => props.downloads.has(video.id)).length}
        folder={activeFolder}
        actions={actions}
        tools={videos.length > 0 && <BulkTools videos={videos} folders={folders} selection={selection} actions={actions} />}
      />

      {folderVideos.length > 0 && (
        <LibraryToolbar
          query={query}
          onChange={props.onQueryChange}
          counts={sourceCounts(folderVideos)}
          shown={videos.length}
        />
      )}

      {videos.length === 0 ? (
        <p className="empty">{emptyMessage(query, activeFolder?.name, props.libraryTotal)}</p>
      ) : (
        <div className="grid">
          {videos.map((video, index) => (
            <VideoCard
              key={video.id}
              video={video}
              index={index}
              download={props.downloads.get(video.id) ?? null}
              playing={props.playingId === video.id}
              folders={folders}
              selecting={selection.active}
              selected={selection.ids.has(video.id)}
              onToggleSelect={selection.toggle}
              actions={actions}
            />
          ))}
        </div>
      )}
    </>
  );
}

interface HeaderProps {
  title: string;
  folderVideos: Video[];
  downloading: number;
  folder: Folder | null;
  actions: LibraryActions;
  tools: React.ReactNode;
}

/** The screen title, what the folder holds, and its own actions. */
function LibraryHeader({ title, folderVideos, downloading, folder, actions, tools }: HeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const missing = folderVideos.filter((video) => !video.file_path).length - downloading;
  const facts = [plural(folderVideos.length, "video")];
  if (folderVideos.length > 0) facts.push(formatLongDuration(totalDuration(folderVideos)));
  if (downloading > 0) facts.push(`${downloading} downloading`);
  if (missing > 0) facts.push(`${missing} not downloaded`);

  useEffect(() => setRenaming(false), [folder?.id]);

  const rename = async () => {
    const name = draft.trim();
    setRenaming(false);
    if (folder && name && name !== folder.name) await actions.renameFolder(folder.id, name);
  };

  const remove = async () => {
    if (!folder) return;
    const ok = await confirmAction(`Delete the folder "${folder.name}"? Its videos stay in the library.`, {
      okLabel: "Delete folder",
      destructive: true,
    });
    if (ok) await actions.deleteFolder(folder.id);
  };

  return (
    <header className="screen-head">
      <div className="screen-titles">
        {renaming ? (
          <input
            className="title-input"
            autoFocus
            aria-label="Folder name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={() => void rename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void rename();
              if (event.key === "Escape") setRenaming(false);
            }}
          />
        ) : (
          <h1 className="screen-title">{title}</h1>
        )}
        <p className="screen-sub">
          {facts.map((fact, i) => (
            <span key={fact} className={i > 0 && fact.includes("downloading") ? "live-fact" : undefined}>
              {fact}
            </span>
          ))}
        </p>
      </div>
      <div className="screen-actions">
        {folder && !renaming && (
          <>
            <button
              className="ghost"
              onClick={() => {
                setDraft(folder.name);
                setRenaming(true);
              }}
            >
              Rename
            </button>
            <button className="ghost danger" onClick={() => void remove()}>
              Delete folder
            </button>
          </>
        )}
        {tools}
      </div>
    </header>
  );
}

function emptyMessage(query: LibraryQuery, folderName: string | undefined, libraryTotal: number): string {
  if (isFiltered(query)) return "No videos match these filters.";
  if (query.folder === ALL) {
    return libraryTotal === 0
      ? "No videos yet. Paste a YouTube, X, Twitch or any other video URL in the sidebar."
      : "No videos.";
  }
  if (query.folder === UNFILED) return "No unfiled videos.";
  return `Nothing in "${folderName ?? "this folder"}" yet.`;
}

/** Bulk selection state. Resets when the folder changes; drops vanished ids. */
function useSelection(videos: Video[], folder: string) {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<Set<string>>(new Set());

  const exit = () => {
    setActive(false);
    setIds(new Set());
  };

  // A folder switch is a new context; a selection that is no longer on
  // screen would make the next bulk action hit videos the user cannot see.
  useEffect(exit, [folder]);

  useEffect(() => {
    setIds((current) => {
      if (current.size === 0) return current;
      const live = new Set(videos.map((video) => video.id));
      const next = new Set([...current].filter((id) => live.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [videos]);

  const toggle = (id: string) =>
    setIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return { active, ids, setIds, start: () => setActive(true), exit, toggle };
}

type Selection = ReturnType<typeof useSelection>;

interface BulkProps {
  videos: Video[];
  folders: Folder[];
  selection: Selection;
  actions: LibraryActions;
}

function BulkTools({ videos, folders, selection, actions }: BulkProps) {
  const [menu, setMenu] = useState<"move" | "delete" | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const allSelected = selection.ids.size === videos.length;

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setMenu(null);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  useEffect(() => {
    if (!selection.active) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (menu) setMenu(null);
      else selection.exit();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [selection, menu]);

  /** Selected ids in on-screen order. */
  const chosen = () => videos.filter((video) => selection.ids.has(video.id)).map((video) => video.id);

  /** A failed action keeps the selection so the user can try again. */
  const finish = (ok: boolean) => {
    if (ok) {
      selection.exit();
      setMenu(null);
    }
  };

  const move = async (folderId: string | null) => {
    const ids = chosen();
    if (ids.length === 0) return;
    setMenu(null);
    finish(await actions.moveVideos(ids, folderId));
  };

  const remove = async (deleteFile: boolean) => {
    const ids = chosen();
    if (ids.length === 0) return;
    setMenu(null);
    const what = plural(ids.length, "video");
    const ok = await confirmAction(
      deleteFile
        ? `Move ${what} to the Trash and remove ${ids.length === 1 ? "it" : "them"} from the library?`
        : `Remove ${what} from the library? The files stay on disk.`,
      { okLabel: deleteFile ? "Move to Trash" : "Remove", destructive: deleteFile },
    );
    if (ok) finish(await actions.removeVideos(ids, deleteFile));
  };

  if (!selection.active) {
    return (
      <button className="ghost" onClick={selection.start}>
        Select
      </button>
    );
  }

  return (
    <div className="bulk-tools" ref={ref}>
      <span className="bulk-count">{selection.ids.size} selected</span>
      <div className="bulk-tools-actions">
        <button
          className="tool-link"
          onClick={() => selection.setIds(allSelected ? new Set() : new Set(videos.map((video) => video.id)))}
        >
          {allSelected ? "Clear" : "Select all"}
        </button>
        <div className="bulk-menu-wrap">
          <button
            className="bulk-action"
            disabled={selection.ids.size === 0}
            onClick={() => setMenu(menu === "move" ? null : "move")}
          >
            Move to
          </button>
          {menu === "move" && (
            <div className="card-menu bulk-menu" role="menu">
              <button role="menuitem" onClick={() => void move(null)}>No folder</button>
              {folders.map((folder) => (
                <button role="menuitem" key={folder.id} onClick={() => void move(folder.id)}>
                  {folder.name}
                </button>
              ))}
              {folders.length === 0 && <span className="menu-empty">No folders yet</span>}
            </div>
          )}
        </div>
        <div className="bulk-menu-wrap">
          <button
            className="bulk-action danger"
            disabled={selection.ids.size === 0}
            onClick={() => setMenu(menu === "delete" ? null : "delete")}
          >
            Delete
          </button>
          {menu === "delete" && (
            <div className="card-menu bulk-menu" role="menu">
              <button role="menuitem" onClick={() => void remove(false)}>Remove from library</button>
              <button role="menuitem" className="danger" onClick={() => void remove(true)}>
                Move files to Trash…
              </button>
            </div>
          )}
        </div>
        <button className="bulk-done" onClick={selection.exit}>
          Done
        </button>
      </div>
    </div>
  );
}
