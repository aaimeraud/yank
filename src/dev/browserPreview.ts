// Browser preview: run the UI in a plain browser (`bun run dev`, then open
// http://localhost:1420) with a fake backend, for design work and visual
// checks. Loaded only in development and only when Tauri is absent; see
// main.tsx. Nothing here ships in a build.

import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { PROGRESS_EVENT } from "../api";
import { makeVideo } from "../test/fixtures";
import type { Folder, ProgressEvent, QueueEntry, Settings, ToolchainReport, Video } from "../types";

const NOW = Math.floor(Date.now() / 1000);
// Real, playable stand-ins for local files: CC0 clips from MDN's examples.
const CLIPS = [
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4",
];
let clip = 0;
const thumb = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

function video(id: string, fields: Partial<Video>): Video {
  return makeVideo(id, {
    title: id,
    file_path: CLIPS[clip++ % CLIPS.length],
    file_size: 180_000_000,
    downloaded_at: NOW - 3600,
    ...fields,
  });
}

const PLAYLIST = "pl-systems";
const FOLDER = "f-systems";
const SD = { uploader: "Hello Interview", playlist_id: PLAYLIST, folder_id: FOLDER };

const videos: Video[] = [
  video("A7xEG6smBAk", { ...SD, title: "Systems Design 3.0 Is Here!", duration: 312, playlist_index: 1, thumbnail_path: thumb("A7xEG6smBAk"), watched: true }),
  video("xFeWVugaouk", { ...SD, title: "Design a URL Shortener (TinyURL, Bit.ly)", duration: 3312, playlist_index: 2, thumbnail_path: thumb("xFeWVugaouk"), last_position: 1420 }),
  video("RLdh1vQsVIQ", { ...SD, title: "Design the Facebook Like Button", duration: 2890, playlist_index: 3, thumbnail_path: thumb("RLdh1vQsVIQ") }),
  video("qogwP78LzAk", { ...SD, title: "Design the Facebook/Twitter News Feed", duration: 3640, playlist_index: 4, thumbnail_path: thumb("qogwP78LzAk") }),
  video("Qi3Kzq_rlKQ", { ...SD, title: "Design Dropbox/Google Drive", duration: 3105, playlist_index: 5, thumbnail_path: thumb("Qi3Kzq_rlKQ") }),
  video("6TroztUV3f8", { ...SD, title: "Design an Ad Click Aggregator", duration: 3020, playlist_index: 6, file_path: null, downloaded_at: null }),
  video("jNQXAC9IVRw", { title: "Me at the zoo", uploader: "jawed", duration: 19, thumbnail_path: thumb("jNQXAC9IVRw"), downloaded_at: NOW - 86400 }),
  video("1853124394226024625", { title: "Liftoff of Crew-9 to the International Space Station", uploader: "NASA", duration: 48, source: "twitter", downloaded_at: NOW - 7200, watched: true }),
  video("v2290000000", { title: "Speedrun any% — world record attempt, 4th try", uploader: "summit1g", duration: 7420, source: "twitch:vod", downloaded_at: NOW - 5000, last_position: 2400 }),
  video("dQw4w9WgXcQ", { title: "Rick Astley - Never Gonna Give You Up (Official Video)", uploader: "Rick Astley", duration: 213, thumbnail_path: thumb("dQw4w9WgXcQ"), downloaded_at: NOW - 900 }),
];

const folders: Folder[] = [
  { id: FOLDER, name: "Systems Design Questions 3.0", created_at: NOW - 86400, video_count: videos.filter((v) => v.folder_id === FOLDER).length },
  { id: "f-later", name: "Watch later", created_at: NOW - 3600, video_count: 0 },
];

function entry(id: string, from: Video, fields: Partial<QueueEntry>): QueueEntry {
  return {
    id,
    video_id: from.id,
    status: "done",
    progress: 100,
    speed: null,
    eta: null,
    error: null,
    created_at: NOW - 600,
    format: "video",
    title: from.title,
    url: from.url,
    source: from.source,
    playlist_id: from.playlist_id,
    playlist_title: from.playlist_id ? "Systems Design Questions 3.0" : null,
    playlist_index: from.playlist_index,
    ...fields,
  };
}

const byId = (id: string) => videos.find((v) => v.id === id)!;
const queue: QueueEntry[] = [
  entry("q1", byId("A7xEG6smBAk"), {}),
  entry("q2", byId("xFeWVugaouk"), {}),
  entry("q3", byId("RLdh1vQsVIQ"), {}),
  entry("q4", byId("qogwP78LzAk"), { status: "downloading", progress: 38, speed: "4200000", eta: "212" }),
  entry("q5", byId("Qi3Kzq_rlKQ"), { status: "downloading", progress: 71, speed: "3100000", eta: "64" }),
  entry("q6", byId("6TroztUV3f8"), {
    status: "failed",
    progress: 4,
    error:
      "[youtube] 6TroztUV3f8: Downloading webpage\nWARNING: [youtube] Some formats are missing\nERROR: unable to download video data: HTTP Error 403: Forbidden",
  }),
  entry("q7", byId("v2290000000"), { status: "paused", progress: 23 }),
];

const settings: Settings = {
  download_dir: "/Users/me/Movies/Yank",
  default_format: "video",
  concurrency: 2,
  cookies_path: null,
};

const toolchain: ToolchainReport = {
  ytdlp_path: "/opt/homebrew/bin/yt-dlp",
  ytdlp_version: "2026.10.26",
  ffmpeg_path: "/opt/homebrew/bin/ffmpeg",
  deno_path: "/opt/homebrew/bin/deno",
};

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  list_videos: () => videos,
  list_folders: () => folders,
  list_queue: () => queue,
  get_settings: () => settings,
  toolchain_info: () => toolchain,
  enqueue_url: () => ({ title: "Systems Design Questions 3.0", is_playlist: true, queued: 9, skipped: 6 }),
  download_diagnostics: () => "Yank (browser preview)",
  prune_missing_videos: () => [],
};

/** Install the fake backend and keep the two running downloads moving. */
export function install() {
  mockIPC((cmd, args) => handlers[cmd]?.((args ?? {}) as Record<string, unknown>) ?? null, {
    shouldMockEvents: true,
  });
  // Thumbnails here are web URLs, not local paths.
  (window as unknown as { __TAURI_INTERNALS__: { convertFileSrc: (p: string) => string } }).__TAURI_INTERNALS__.convertFileSrc =
    (path) => path;

  setInterval(() => {
    for (const row of queue) {
      if (row.status !== "downloading") continue;
      row.progress = row.progress >= 100 ? 2 : Math.min(100, row.progress + 0.6);
      const event: ProgressEvent = {
        queue_id: row.id,
        status: "downloading",
        progress: row.progress,
        speed: row.speed,
        eta: row.eta,
      };
      void emit(PROGRESS_EVENT, event);
    }
  }, 500);
}
