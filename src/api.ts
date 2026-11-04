// The only file that knows command names. Every backend call goes through
// here, so a renamed Rust command breaks the type check instead of failing
// at runtime. Commands live in src-tauri/src/commands/.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  EnqueueSummary,
  Folder,
  Format,
  ProgressEvent,
  QueueEntry,
  Settings,
  ToolchainReport,
  Video,
} from "./types";

/** Keys accepted by `set_setting` (see src-tauri/src/settings.rs). */
export type SettingKey = "download_dir" | "default_quality" | "concurrency" | "cookies_path";

export const api = {
  // Library
  listVideos: () => invoke<Video[]>("list_videos"),
  listFolders: () => invoke<Folder[]>("list_folders"),
  createFolder: (name: string) => invoke<Folder>("create_folder", { name }),
  renameFolder: (id: string, name: string) => invoke<void>("rename_folder", { id, name }),
  deleteFolder: (id: string) => invoke<void>("delete_folder", { id }),
  moveVideos: (videoIds: string[], folderId: string | null) =>
    invoke<void>("move_videos", { videoIds, folderId }),
  removeVideos: (videoIds: string[], deleteFile: boolean) =>
    invoke<void>("remove_videos", { videoIds, deleteFile }),
  updatePlayback: (videoId: string, position: number, watched: boolean) =>
    invoke<void>("update_playback", { videoId, position, watched }),
  /** Returns the ids whose file is gone (and were cleared). */
  pruneMissingVideos: (ids: string[]) => invoke<string[]>("prune_missing_videos", { ids }),
  revealVideo: (videoId: string) => invoke<void>("reveal_video", { videoId }),

  // Downloads
  enqueueUrl: (url: string, format: Format | null) =>
    invoke<EnqueueSummary>("enqueue_url", { url, format }),
  downloadVideo: (videoId: string, format: Format | null = null) =>
    invoke<void>("download_video", { videoId, format }),
  listQueue: () => invoke<QueueEntry[]>("list_queue"),
  pauseDownload: (queueId: string) => invoke<void>("pause_download", { queueId }),
  resumeDownload: (queueId: string) => invoke<void>("resume_download", { queueId }),
  cancelDownload: (queueId: string) => invoke<void>("cancel_download", { queueId }),
  removeDownload: (queueId: string) => invoke<void>("remove_download", { queueId }),
  clearFinishedDownloads: () => invoke<void>("clear_finished_downloads"),
  pauseAllDownloads: () => invoke<number>("pause_all_downloads"),
  resumeAllDownloads: () => invoke<number>("resume_all_downloads"),
  retryFailedDownloads: () => invoke<number>("retry_failed_downloads"),
  downloadDiagnostics: (queueId: string) => invoke<string>("download_diagnostics", { queueId }),

  // Settings and system
  getSettings: () => invoke<Settings>("get_settings"),
  /** Returns the settings as stored, after validation and defaults. */
  setSetting: (key: SettingKey, value: string) => invoke<Settings>("set_setting", { key, value }),
  pickFolder: () => invoke<string | null>("pick_folder"),
  pickCookiesFile: () => invoke<string | null>("pick_cookies_file"),
  toolchainInfo: () => invoke<ToolchainReport>("toolchain_info"),
  openLogsFolder: () => invoke<void>("open_logs_folder"),
};

/** Subscribe to download progress. Returns the unsubscribe function. */
export function onProgress(handler: (event: ProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ProgressEvent>("download-progress", (event) => handler(event.payload));
}
