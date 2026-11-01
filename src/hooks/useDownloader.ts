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
      }

      const queued = await queueEntries(
        { metas, playlistId, downloadDir: dir, videos, queue, formatPref },
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
