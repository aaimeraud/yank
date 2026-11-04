import { useEffect, useRef, useState } from "react";
import type { Folder, Video } from "../types";
import { ALL, UNFILED } from "../lib/libraryFilter";
import { isFiltered, type LibraryQuery } from "../lib/libraryView";
import { confirmAction } from "../lib/confirm";
import { plural } from "../lib/format";
import FolderBar from "./FolderBar";
import LibraryToolbar from "./LibraryToolbar";
import VideoCard, { type CardActions } from "./VideoCard";

/** Folder and bulk operations; each resolves to false when it failed. */
export interface LibraryActions extends CardActions {
  createFolder: (name: string) => Promise<Folder | null>;
  renameFolder: (id: string, name: string) => Promise<unknown>;
  deleteFolder: (id: string) => Promise<unknown>;
  moveVideos: (videoIds: string[], folderId: string | null) => Promise<boolean>;
  removeVideos: (videoIds: string[], deleteFile: boolean) => Promise<boolean>;
}

interface Props {
  /** Already filtered and sorted (see lib/libraryView.ts). */
  videos: Video[];
  /** Size of the current folder before search and filters. */
  folderTotal: number;
  libraryTotal: number;
  unfiled: number;
  folders: Folder[];
  query: LibraryQuery;
  onQueryChange: (patch: Partial<LibraryQuery>) => void;
  actions: LibraryActions;
}

export default function Library(props: Props) {
  const { videos, folders, query, actions } = props;
  const selection = useSelection(videos, query.folder);
  const activeFolder = folders.find((folder) => folder.id === query.folder);

  return (
    <>
      <FolderBar
        folders={folders}
        total={props.libraryTotal}
        unfiled={props.unfiled}
        selected={query.folder}
        onSelect={(folder) => props.onQueryChange({ folder })}
        onCreate={actions.createFolder}
        onRename={actions.renameFolder}
        onDelete={actions.deleteFolder}
      />

      {props.folderTotal > 0 && (
        <LibraryToolbar
          query={query}
          onChange={props.onQueryChange}
          shown={videos.length}
          total={props.folderTotal}
        />
      )}

      {videos.length > 0 && <BulkTools videos={videos} folders={folders} selection={selection} actions={actions} />}

      {videos.length === 0 ? (
        <p className="empty">{emptyMessage(query, activeFolder?.name, props.libraryTotal)}</p>
      ) : (
        <div className="grid">
          {videos.map((video) => (
            <VideoCard
              key={video.id}
              video={video}
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
      deleteFile ? `Delete ${what} from disk? This cannot be undone.` : `Remove ${what} from the library? The files stay on disk.`,
      { okLabel: deleteFile ? "Delete" : "Remove", destructive: deleteFile },
    );
    if (ok) finish(await actions.removeVideos(ids, deleteFile));
  };

  if (!selection.active) {
    return (
      <div className="library-tools">
        <div className="library-tools-actions">
          <button className="tool-link" onClick={selection.start}>
            Select
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="library-tools">
      <span className="bulk-count">{selection.ids.size} selected</span>
      <div className="library-tools-actions" ref={ref}>
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
                Delete files…
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
