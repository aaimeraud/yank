import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Video } from "../types";
import { enqueueId, playNextId, takeNextPlayable } from "../lib/playQueue";

/**
 * The explicit play queue. It is intentionally in-memory: a queue is a
 * "right now" list, and persisting it would resurrect stale ids across
 * launches. Library refreshes prune entries whose file disappeared, and the
 * player re-checks the file right before using an entry because a file can be
 * deleted in Finder while the app is running.
 */
export function usePlayQueue(videos: Video[], onFileMissing?: () => Promise<void> | void) {
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds((current) => {
      const next = current.filter((id) =>
        videos.some((video) => video.id === id && video.file_path),
      );
      return next.length === current.length ? current : next;
    });
  }, [videos]);

  const items = useMemo(
    () =>
      ids
        .map((id) => videos.find((video) => video.id === id))
        .filter((video): video is Video => !!video?.file_path),
    [ids, videos],
  );

  /**
   * Ask the backend which of these rows lost the file behind them. The library
   * snapshot cannot answer that: deleting a download in Finder leaves the row
   * untouched until something looks at the disk.
   */
  const dropMissing = useCallback(
    async (candidates: string[]): Promise<Set<string>> => {
      if (candidates.length === 0) return new Set();
      const missing = await api.pruneMissingVideos(candidates);
      if (missing.length > 0) await onFileMissing?.();
      return new Set(missing);
    },
    [onFileMissing],
  );

  /** True when the video still has a file on disk. Clears the row when it does not. */
  const verify = useCallback(
    async (video: Video): Promise<boolean> => {
      if (!video.file_path) return false;
      const missing = await dropMissing([video.id]);
      return !missing.has(video.id);
    },
    [dropMissing],
  );

  /** Drop queued entries whose files vanished mid-session. */
  const pruneMissing = useCallback(async () => {
    if (ids.length === 0) return;
    const missing = await dropMissing(ids);
    if (missing.size > 0) {
      setIds((current) => current.filter((id) => !missing.has(id)));
    }
  }, [ids, dropMissing]);

  const enqueue = useCallback((video: Video) => {
    setIds((current) => enqueueId(current, video.id));
  }, []);

  const playNext = useCallback((video: Video) => {
    setIds((current) => playNextId(current, video.id));
  }, []);

  const remove = useCallback((id: string) => {
    setIds((current) => current.filter((queued) => queued !== id));
  }, []);

  /** Drop a bulk selection from the queue in one state update. */
  const removeMany = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const drop = new Set(ids);
    setIds((current) => current.filter((id) => !drop.has(id)));
  }, []);

  const clear = useCallback(() => setIds([]), []);

  /**
   * Take the next playable entry, skipping entries whose file is gone and the
   * video that just finished. The queue is drained even when nothing is
   * playable, so a queue holding only the current video cannot replay it.
   */
  const takeNext = useCallback(
    async (currentId?: string): Promise<Video | null> => {
      let remaining = ids;
      let chosen: Video | null = null;
      while (remaining.length > 0) {
        const { video, rest } = takeNextPlayable(remaining, videos, currentId);
        remaining = rest;
        if (!video) break;
        if (await verify(video)) {
          chosen = video;
          break;
        }
      }
      // Drop exactly what this call consumed. Filtering against `remaining`
      // would also drop entries queued while the checks were in flight.
      const consumed = new Set(ids.filter((id) => !remaining.includes(id)));
      setIds((current) => current.filter((id) => !consumed.has(id)));
      return chosen;
    },
    [ids, videos, verify],
  );

  return { items, enqueue, playNext, remove, removeMany, clear, takeNext, verify, pruneMissing };
}
