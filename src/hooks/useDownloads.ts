import { useCallback, useEffect, useRef, useState } from "react";
import { api, onProgress } from "../api";
import { applyProgress, replayEvents } from "../lib/queueGroups";
import { succeeds } from "../lib/notify";
import type { ProgressEvent, QueueEntry } from "../types";

/**
 * The download queue. Loaded from the backend, then kept live by progress
 * events; any action refreshes the list from the database afterwards.
 * `onFinished` runs when a download completes, so the library can reload.
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

  const refresh = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void refresh();
    const unlisten = onProgress((event) => {
      if (inFlight.current > 0) pending.current.push(event);
      setQueue((rows) => applyProgress(rows, event));
      // A row this list has not loaded yet (queued from elsewhere): reload.
      if (!queueRef.current.some((row) => row.id === event.queue_id)) void refresh();
      if (event.status === "done") finishedRef.current?.();
    });
    return () => {
      void unlisten.then((stop) => stop());
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
