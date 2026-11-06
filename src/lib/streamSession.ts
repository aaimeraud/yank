// The rules of a stream session (ADR 0010), pure so they are tested
// without a player: what plays next, what Previous goes back to, how saved
// positions and deleted files flow into the list, and where the <video>
// gets its media from. hooks/usePlayer.ts holds the state and does the
// async part (resolving URLs, checking files).

import type { Stream, Video } from "../types";
import { patchPlayback as patchVideo } from "./playback";

/** One video to stream: what the player shows, and the page yt-dlp resolves. */
export interface StreamItem {
  video: Video;
  /** The watch URL, resolved to a stream right before playing. */
  url: string;
  /** Known live before resolving (from the search hit), so Download never shows for it. */
  live: boolean;
}

/**
 * Videos watched from the YouTube screen, in the order they were listed.
 * While a session is open, Next and autoplay go through it, after anything
 * in the user's own queue.
 */
export interface StreamSession {
  items: StreamItem[];
  index: number;
  /** "Next from …" in the queue panel. */
  label: string;
}

/** A stream URL resolved for one item. */
export interface Resolved {
  url: string;
  stream: Stream;
}

/** Where the element gets its media from right now. */
export interface PlayerSource {
  /** Undefined while a stream is still being resolved. */
  src: string | undefined;
  streaming: boolean;
  /** Resolving the stream, before there is anything to play. */
  loading: boolean;
  /** Why the stream could not start; the player offers to try again. */
  error: string | null;
  isLive: boolean;
}

export function currentItem(session: StreamSession | null): StreamItem | null {
  return session ? (session.items[session.index] ?? null) : null;
}

/** The session moved to `index`, or null when there is no such item. */
export function moveTo(session: StreamSession, index: number): StreamSession | null {
  return session.items[index] ? { ...session, index } : null;
}

/**
 * What Next does: the user's queue first (`queued` is its first playable
 * video, if any), then the session's next item.
 */
export function nextStep(session: StreamSession, queued: string | null): { from: "queue" } | { from: "session"; index: number } | null {
  if (queued) return { from: "queue" };
  const index = session.index + 1;
  return session.items[index] ? { from: "session", index } : null;
}

export function previousIndex(session: StreamSession): number | null {
  return session.index > 0 ? session.index - 1 : null;
}

function mapItems(session: StreamSession, change: (item: StreamItem, index: number) => StreamItem): StreamSession {
  let changed = false;
  const items = session.items.map((item, index) => {
    const next = change(item, index);
    if (next !== item) changed = true;
    return next;
  });
  return changed ? { ...session, items } : session;
}

/**
 * A position was saved for `id`: every item showing that video takes it,
 * so going back to it resumes there. Same object when nothing changed.
 */
export function patchPlayback(session: StreamSession, id: string, position: number, watched: boolean): StreamSession {
  return mapItems(session, (item) => {
    if (item.video.id !== id) return item;
    const video = patchVideo(item.video, position, watched);
    return video === item.video ? item : { ...item, video };
  });
}

/** These videos' files are gone: their items stream instead. */
export function forgetFiles(session: StreamSession, ids: Iterable<string>): StreamSession {
  const gone = new Set(ids);
  return mapItems(session, (item) =>
    gone.has(item.video.id) && item.video.file_path ? { ...item, video: { ...item.video, file_path: null } } : item,
  );
}

/**
 * Where a retry resumes: the second the element last reported, or, when it
 * reported none (the stream never started: the resolve failed, or it died
 * before its first frame), where the item was going to resume. Never 0 by
 * accident, which the next save would write over the stored position.
 */
export function retryPosition(item: StreamItem, lastReported: number): number {
  return lastReported > 0 ? lastReported : item.video.last_position;
}

/**
 * Library rows changed (a hit of the list finished downloading, or lost
 * its file): the items that are not playing follow, so reaching one plays
 * its file. The current item keeps its source (switching it would restart
 * what is on screen) unless `includeCurrent`: the session is moving to it.
 */
export function syncFromLibrary(session: StreamSession, library: Map<string, Video>, includeCurrent = false): StreamSession {
  return mapItems(session, (item, index) => {
    if (index === session.index && !includeCurrent) return item;
    const row = library.get(item.video.id);
    if (!row || row.file_path === item.video.file_path) return item;
    return { ...item, video: { ...item.video, file_path: row.file_path, thumbnail_path: row.thumbnail_path ?? item.video.thumbnail_path } };
  });
}

/** Try the current item again from `position` seconds. */
export function resumeAt(session: StreamSession, position: number): StreamSession {
  return mapItems(session, (item, index) =>
    index === session.index ? { ...item, video: { ...item.video, last_position: Math.max(0, Math.floor(position)) } } : item,
  );
}

/**
 * The media for the current item: its file when it is on disk, otherwise
 * the stream resolved for it (undefined while resolving, or when that
 * failed). A resolution for another item never applies.
 */
export function sessionSource(
  item: StreamItem,
  resolved: Resolved | null,
  error: string | null,
  fileSrc: (path: string) => string,
): PlayerSource {
  if (item.video.file_path) {
    return { src: fileSrc(item.video.file_path), streaming: false, loading: false, error: null, isLive: false };
  }
  const mine = resolved?.url === item.url ? resolved : null;
  return {
    src: mine?.stream.url,
    streaming: true,
    loading: !mine && error === null,
    error,
    isLive: item.live || !!mine?.stream.is_live,
  };
}
