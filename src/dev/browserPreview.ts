// Browser preview: run the UI in a plain browser (`bun run dev`, then open
// http://localhost:1420) with a fake backend, for design work and visual
// checks. Loaded only in development and only when Tauri is absent; see
// main.tsx. Nothing here ships in a build.

import { mockIPC } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { PROGRESS_EVENT } from "../api";
import { makeVideo } from "../test/fixtures";
import type { Folder, ProgressEvent, QueueEntry, SearchPage, SearchResult, Settings, Stream, ToolchainReport, UrlInfo, Video } from "../types";

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

// The YouTube screen. Real ids, so the thumbnails load; a few match the
// library above to show "In library" and a live download.
const hits: SearchResult[] = [
  ["dQw4w9WgXcQ", "Rick Astley - Never Gonna Give You Up (Official Video)", "Rick Astley", 213, 1_700_000_000],
  ["qogwP78LzAk", "Design the Facebook/Twitter News Feed", "Hello Interview", 3640, 182_000],
  ["rFZHOHl-L8A", "lofi hip hop radio 📚 beats to relax/study to", "Lofi Girl", null, 31_000, "is_live"],
  ["rQ_J9WH6CGk", "Rust Programming Full Course | Learn ⚙️ in 2024", "BekBrace", 11104, 670_146],
  ["BpPEoZW5IiY", "Learn Rust Programming - Complete Course 🦀", "freeCodeCamp.org", 50350, 1_301_151],
  ["5C_HPTJg5ek", "Rust in 100 Seconds", "Fireship", 149, 2_644_974],
  ["0y6RKiIk6cs", "Rust for Dummies in 12 Minutes", "Let's Get Rusty", 750, 519_048],
  ["TB2wqzGSsqM", "Why Rust Tutorials Do This Every Time? - Tsoding", "Tsoding Highlights", 132, 113_797],
  ["gPa_ZK8JBtw", "The Ultimate RUST Beginner Guide! (2026)", "Kysen", 4546, 178_824],
  ["TSn2vCNvFkU", "How to Learn Rust (For Hackers)", "CyberFlow", 389, 58_888],
].map(([id, title, channel, duration, views, live]) => ({
  kind: "video",
  id: id as string,
  title: title as string,
  url: `https://www.youtube.com/watch?v=${id}`,
  channel: channel as string,
  duration: duration as number | null,
  view_count: views as number,
  thumbnail: thumb(id as string),
  live_status: (live as string | undefined) ?? null,
}));

const playlistHits: SearchResult[] = [
  { id: "PLai5B987bZ9CoVR-QEIN9foz4QCJ0H2Y8", title: "The Rust Lang Book", channel: "Let's Get Rusty", thumb: "OX9HJsJUDxA" },
  { id: "PLMoBiI7mY1lo", title: "Rust 2026 – Features, Setup & Full Tutorial", channel: "C4D sSs", thumb: "Wc0ZJo06oAw" },
  { id: "PLqloAi0326F86lh0UjCOUv8d8rpzWjFLx", title: "Rust Tutorials & Guides", channel: "Drizzza", thumb: "rdGfJgNUXgc" },
].map((p) => ({
  kind: "playlist",
  id: p.id,
  title: p.title,
  url: `https://www.youtube.com/playlist?list=${p.id}`,
  channel: p.channel,
  duration: null,
  view_count: null,
  thumbnail: thumb(p.thumb),
  live_status: null,
}));

const later = <T,>(value: T, ms = 700) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
  list_videos: () => videos,
  list_folders: () => folders,
  list_queue: () => queue,
  get_settings: () => settings,
  toolchain_info: () => toolchain,
  enqueue_url: () => ({ title: "Systems Design Questions 3.0", is_playlist: true, queued: 9, skipped: 6 }),
  download_diagnostics: () => "Yank (browser preview)",
  prune_missing_videos: () => [],
  search_youtube: ({ query, kind, page }) => {
    if (String(query).toLowerCase().includes("error")) {
      return later(null).then(() => Promise.reject("ERROR: [youtube:search_url] Unable to download API page: HTTP Error 429: Too Many Requests"));
    }
    if (String(query).toLowerCase().includes("nothing")) return later<SearchPage>({ results: [], has_more: false });
    const pool = kind === "playlist" ? playlistHits : hits;
    // Two pages of the same hits under new ids, then the end.
    const results = pool.map((hit) => (page === 0 ? hit : { ...hit, id: `${hit.id}-p${page}`, title: `${hit.title} (part ${Number(page) + 1})` }));
    return later<SearchPage>({ results, has_more: Number(page) < 1 && kind === "video" });
  },
  inspect_url: () =>
    later<UrlInfo>({
      title: "The Rust Lang Book",
      is_playlist: true,
      entries: [...hits.filter((hit) => !hit.live_status), { ...hits[3], id: "gone1", title: "[Private video]" }].map((hit, i) => ({
        id: hit.id,
        title: hit.title,
        uploader: hit.channel,
        duration: hit.duration,
        thumbnail: hit.thumbnail,
        extractor: "Youtube",
        webpage_url: hit.url,
        index: i + 1,
        live_status: hit.live_status,
      })),
    }),
  // A browser cannot play YouTube's HLS (WKWebView can); a CC0 clip stands in.
  stream_video: () => later<Stream>({ url: CLIPS[1], is_hls: false, is_live: false }, 1200),
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
