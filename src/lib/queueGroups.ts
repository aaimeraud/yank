// Shaping the download queue for the Downloads view: rows grouped by
// playlist with a "12 of 15 downloaded, 3 failed" summary, and the one line
// of a yt-dlp error worth showing before the user expands the details.

import type { ProgressEvent, QueueEntry, QueueStatus } from "../types";

/**
 * Patch the row a progress event is about. Fields the event leaves out keep
 * their value; an empty error string clears the error (sent on a retry).
 */
export function applyProgress(rows: QueueEntry[], event: ProgressEvent): QueueEntry[] {
  return rows.map((row) =>
    row.id === event.queue_id
      ? {
          ...row,
          status: event.status,
          progress: event.progress ?? row.progress,
          // The backend always sends speed and eta; null clears them.
          speed: event.speed !== undefined ? event.speed : row.speed,
          eta: event.eta !== undefined ? event.eta : row.eta,
          error: event.error === undefined ? row.error : event.error || null,
        }
      : row,
  );
}

/**
 * A reload of the queue is a snapshot from when the database was read.
 * Events that arrived while the request was in flight may be newer than it
 * (a download finishing mid-refresh); replaying them on top keeps a "done"
 * from being overwritten by a stale "downloading 99%".
 */
export function replayEvents(snapshot: QueueEntry[], events: ProgressEvent[]): QueueEntry[] {
  return events.reduce(applyProgress, snapshot);
}

export interface QueueGroup {
  /** The playlist id, or the queue id for a standalone download. */
  key: string;
  /** Playlist title; null for a standalone download. */
  title: string | null;
  entries: QueueEntry[];
  counts: Record<QueueStatus, number>;
}

const EMPTY_COUNTS: Record<QueueStatus, number> = {
  queued: 0,
  downloading: 0,
  paused: 0,
  done: 0,
  failed: 0,
  cancelled: 0,
};

/**
 * One group per playlist, in the order its first row was queued, with the
 * rows sorted by playlist position. Standalone downloads are groups of one.
 */
export function groupQueue(entries: QueueEntry[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>();
  for (const entry of entries) {
    const key = entry.playlist_id ?? entry.id;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: entry.playlist_id ? (entry.playlist_title ?? "Playlist") : null,
        entries: [],
        counts: { ...EMPTY_COUNTS },
      };
      groups.set(key, group);
    }
    group.entries.push(entry);
    group.counts[entry.status] += 1;
  }
  for (const group of groups.values()) {
    group.entries.sort((a, b) => (a.playlist_index ?? 0) - (b.playlist_index ?? 0));
  }
  return [...groups.values()];
}

/** "12 of 15 downloaded · 3 failed". */
export function groupSummary(group: QueueGroup): string {
  const { counts } = group;
  const total = group.entries.length;
  const parts = [`${counts.done} of ${total} downloaded`];
  if (counts.downloading) parts.push(`${counts.downloading} in progress`);
  if (counts.queued) parts.push(`${counts.queued} waiting`);
  if (counts.paused) parts.push(`${counts.paused} paused`);
  if (counts.failed) parts.push(`${counts.failed} failed`);
  if (counts.cancelled) parts.push(`${counts.cancelled} cancelled`);
  return parts.join(" · ");
}

/** Overall percent of a group, counting finished rows as 100. */
export function groupProgress(group: QueueGroup): number {
  if (group.entries.length === 0) return 0;
  const sum = group.entries.reduce(
    (acc, entry) => acc + (entry.status === "done" ? 100 : entry.progress),
    0,
  );
  return sum / group.entries.length;
}

/**
 * The line of yt-dlp's stderr to show collapsed: the last "ERROR:" line,
 * without the prefix, else the last non-empty line.
 */
export function errorHeadline(error: string | null | undefined): string {
  if (!error) return "";
  const lines = error
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const errorLine = [...lines].reverse().find((line) => line.startsWith("ERROR:"));
  return (errorLine ?? lines[lines.length - 1] ?? "").replace(/^ERROR:\s*/, "");
}

interface IntakeSummary {
  /** Rows downloading or waiting for a slot. */
  active: number;
  /** Average progress of the active rows, 0 to 100. */
  progress: number;
  /** The row to name: the furthest-along download, else the first waiting. */
  current: QueueEntry | null;
  label: string;
}

/** What the top bar says about the queue right now. */
export function intakeSummary(queue: QueueEntry[]): IntakeSummary {
  const running = queue.filter((entry) => entry.status === "downloading");
  const waiting = queue.filter((entry) => entry.status === "queued");
  const active = running.length + waiting.length;
  if (active === 0) {
    const failed = queue.filter((entry) => entry.status === "failed").length;
    return {
      active: 0,
      progress: 0,
      current: null,
      label: failed > 0 ? `${failed} failed` : "Nothing downloading",
    };
  }
  const progress = [...running, ...waiting].reduce((sum, entry) => sum + entry.progress, 0) / active;
  const current = [...running].sort((a, b) => b.progress - a.progress)[0] ?? waiting[0];
  const parts = [];
  if (running.length) parts.push(`${running.length} downloading`);
  if (waiting.length) parts.push(`${waiting.length} waiting`);
  return { active, progress, current, label: `${parts.join(", ")} · ${Math.round(progress)}%` };
}

export const STATUS_LABEL: Record<QueueStatus, string> = {
  queued: "Queued",
  downloading: "Downloading",
  paused: "Paused",
  done: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const isActive = (status: QueueStatus) => status === "queued" || status === "downloading";
export const isFinished = (status: QueueStatus) =>
  status === "done" || status === "failed" || status === "cancelled";

/** The line under the Downloads title: "2 downloading · 1 failed · 4 done". */
export function queueHeadline(queue: QueueEntry[]): string {
  if (queue.length === 0) return "Nothing in the queue.";
  const count = (status: QueueStatus) => queue.filter((entry) => entry.status === status).length;
  const parts: string[] = [];
  const order: [QueueStatus, string][] = [
    ["downloading", "downloading"],
    ["queued", "waiting"],
    ["paused", "paused"],
    ["failed", "failed"],
    ["done", "done"],
  ];
  for (const [status, word] of order) {
    const n = count(status);
    if (n > 0) parts.push(`${n} ${word}`);
  }
  return parts.join(" · ");
}
