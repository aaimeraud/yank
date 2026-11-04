// Turning raw numbers into the short labels the UI shows.

/** 75 -> "1:15", 3725 -> "1:02:05". Junk and negatives read as 0:00. */
export function formatClock(seconds: number | null | undefined): string {
  const total = Number.isFinite(seconds) && seconds! > 0 ? Math.floor(seconds!) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** A duration for metadata lines: empty when unknown instead of "0:00". */
export function formatDuration(seconds: number | null | undefined): string {
  return seconds && seconds > 0 ? formatClock(seconds) : "";
}

/** yt-dlp's bytes-per-second string -> "2.4 MB/s". Empty when unknown. */
export function formatSpeed(raw: string | null | undefined): string {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return "";
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(n / 1e3))} KB/s`;
}

/** yt-dlp's seconds-left string -> "3m 20s left". Empty when unknown. */
export function formatEta(raw: string | null | undefined): string {
  const n = Number(raw);
  if (!raw || !Number.isFinite(n) || n <= 0) return "";
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m > 0 ? `${m}m ${s}s left` : `${s}s left`;
}

/** 1536000 -> "1.5 MB". Empty when unknown. */
export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** "1 video", "3 videos". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** 11520 -> "3 h 12 min", 540 -> "9 min". For totals, not for a clock. */
export function formatLongDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
