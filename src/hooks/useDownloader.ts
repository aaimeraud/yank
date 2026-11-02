import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Metadata, PlaylistInfo, QueueItem, Video } from "../types";
import { queueEntries } from "../lib/queueEntries";

interface Options {
  videos: Video[];
  queue: QueueItem[];
  downloadDir: string | null;
  formatPref: string;
  onQueued: (isPlaylist: boolean) => Promise<void> | void;
}

export function useDownloader({ videos, queue, downloadDir, formatPref, onQueued }: Options) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      const info = await invoke<PlaylistInfo>("fetch_playlist_info", { url });
      if (info.is_playlist && info.entries.length === 0) {
        alert("This playlist is empty or private.");
        return;
      }
      const metas = info.entries.length
        ? info.entries
        : [await invoke<Metadata>("fetch_metadata", { url })];
      const dir =
        downloadDir ?? (await invoke<string | null>("get_setting", { key: "download_dir" })) ?? "";
      if (!dir) {
        alert("Pick a downloads folder in Settings first.");
        return;
      }

      let playlistId: string | null = null;
      let folderId: string | null = null;
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
        // Resolve the folder before the entries exist so add_video can file
        // each new row directly, with no second pass over the library. The
        // entry ids let the backend adopt videos the user already downloaded
        // standalone before this playlist existed.
        const entryIds = metas.map((meta) => meta.id).filter((id) => id.length > 0);
        folderId = await invoke<string>("ensure_playlist_folder", { playlistId, entryIds });
      }

      const queued = await queueEntries(
        { metas, playlistId, folderId, downloadDir: dir, videos, queue, formatPref },
        invoke,
      );

      setUrl("");
      await onQueued(info.is_playlist);
      if (queued === 0) alert("Everything in this playlist is already downloaded.");
    } catch (e) {
      alert(String(e));
    } finally {
      setBusy(false);
    }
  };

  return { url, setUrl, busy, submit };
}
