import { useCallback, useEffect, useRef, useState } from "react";
import { api, onProgress } from "../api";
import { applyProgress, replayEvents } from "../lib/queueGroups";
import { succeeds } from "../lib/notify";
import type { ProgressEvent, QueueEntry } from "../types";

/** A playlist finishes many videos in a row; the library reloads once per burst. */
const FINISHED_DEBOUNCE_MS = 500;

/**
 * The download queue. Loaded from the backend, then kept live by progress
 * events; any action refreshes the list from the database afterwards.
 * `onFinished` runs after downloads complete (once per burst), so the
 * library can reload.
 */
export function useDownloads(onFinished?: () => void) {
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  // Read by the event listener, which is installed once.
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;
  // Events received while at least one reload is in flight; replayed on top
  // of its result (see replayEvents).
  const inFlight = useRef(0);
  const pending = useRef<ProgressEvent[]>([]);
  // An event for an unknown row arrived during a reload: reload once more
  // after it, instead of once per event.
  const stale = useRef(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    inFlight.current += 1;
    const start = pending.current.length;
    try {
      await succeeds(async () => {
        const snapshot = await api.listQueue();
        setQueue(replayEvents(snapshot, pending.current.slice(start)));
      });
    } finally {
      inFlight.current -= 1;
      if (inFlight.current === 0) pending.current = [];
    }
    if (inFlight.current === 0 && stale.current) {
      stale.current = false;
      await refresh();
    }
  }, []);

  useEffect(() => {
    void refresh();
    const unlisten = onProgress((event) => {
      if (inFlight.current > 0) pending.current.push(event);
      setQueue((rows) => applyProgress(rows, event));
      // A row this list has not loaded yet (queued from elsewhere): reload.
      if (!queueRef.current.some((row) => row.id === event.queue_id)) {
        if (inFlight.current > 0) stale.current = true;
        else void refresh();
      }
      if (event.status === "done" && !finishTimer.current) {
        finishTimer.current = setTimeout(() => {
          finishTimer.current = null;
          finishedRef.current?.();
        }, FINISHED_DEBOUNCE_MS);
      }
    });
    return () => {
      void unlisten.then((stop) => stop());
      if (finishTimer.current) clearTimeout(finishTimer.current);
    };
  }, [refresh]);

  /** Run a queue action, then reload the rows it touched. */
  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      await succeeds(action);
      await refresh();
    },
    [refresh],
  );

  return {
    queue,
    refresh,
    pause: (id: string) => run(() => api.pauseDownload(id)),
    resume: (id: string) => run(() => api.resumeDownload(id)),
    cancel: (id: string) => run(() => api.cancelDownload(id)),
    remove: (id: string) => run(() => api.removeDownload(id)),
    clearFinished: () => run(api.clearFinishedDownloads),
    pauseAll: () => run(api.pauseAllDownloads),
    resumeAll: () => run(api.resumeAllDownloads),
    retryFailed: () => run(api.retryFailedDownloads),
  };
}
