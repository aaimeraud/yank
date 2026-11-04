import { useState } from "react";
import type { Folder } from "../types";
import { ALL, UNFILED } from "../lib/libraryFilter";
import { confirmAction } from "../lib/confirm";

interface Props {
  folders: Folder[];
  total: number;
  unfiled: number;
  selected: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => Promise<Folder | null>;
  onRename: (id: string, name: string) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

export default function FolderBar({
  folders,
  total,
  unfiled,
  selected,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

  const active = folders.find((folder) => folder.id === selected) ?? null;

  const select = (id: string) => {
    setRenaming(false);
    setCreating(false);
    onSelect(id);
  };

  const submitCreate = async () => {
    const name = draft.trim();
    if (!name) {
      setCreating(false);
      setDraft("");
      return;
    }
    const folder = await onCreate(name);
    setDraft("");
    setCreating(false);
    if (folder) onSelect(folder.id);
  };

  const submitRename = async () => {
    if (!active) return;
    const name = draft.trim();
    if (name && name !== active.name) await onRename(active.id, name);
    setDraft("");
    setRenaming(false);
  };

  const remove = async () => {
    if (!active) return;
    const ok = await confirmAction(`Delete the folder "${active.name}"? Its videos stay in the library.`, {
      okLabel: "Delete folder",
      destructive: true,
    });
    if (!ok) return;
    await onDelete(active.id);
    setRenaming(false);
  };

  const chip = (id: string, label: string, count: number) => (
    <button
      key={id}
      className={"folder-chip" + (selected === id ? " active" : "")}
      onClick={() => select(id)}
    >
      {label}
      <span className="count">{count}</span>
    </button>
  );

  return (
    <div className="folder-bar">
      <div className="folder-chips">
        {chip(ALL, "All videos", total)}
        {chip(UNFILED, "Unfiled", unfiled)}
        {folders.map((folder) =>
          renaming && active?.id === folder.id ? (
            <input
              key={folder.id}
              className="folder-input"
              autoFocus
              title="Press Enter to rename, Escape to cancel"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitRename();
                if (e.key === "Escape") {
                  setRenaming(false);
                  setDraft("");
                }
              }}
            />
          ) : (
            chip(folder.id, folder.name, folder.video_count)
          ),
        )}

        {creating ? (
          <input
            className="folder-input"
            autoFocus
            placeholder="Folder name"
            title="Press Enter to create, Escape to cancel"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCreate();
              if (e.key === "Escape") {
                setCreating(false);
                setDraft("");
              }
            }}
          />
        ) : (
          <button
            className="folder-add"
            onClick={() => {
              setRenaming(false);
              setDraft("");
              setCreating(true);
            }}
          >
            + New folder
          </button>
        )}
      </div>

      {active && !renaming && (
        <div className="folder-actions">
          <button
            onClick={() => {
              setDraft(active.name);
              setRenaming(true);
            }}
          >
            Rename
          </button>
          <button className="danger" onClick={remove}>
            Delete folder
          </button>
        </div>
      )}
    </div>
  );
}
