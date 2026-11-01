import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { QueueItem } from "../types";

interface ProgressEvent {
  queue_id: string;
  status: string;
  progress?: number;
  speed?: string;
  eta?: string;
  error?: string;
}

export function useDownloads(onFinished?: () => void) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const finishedRef = useRef(onFinished);
  finishedRef.current = onFinished;

  const refresh = useCallback(async () => {
    setQueue(await invoke<QueueItem[]>("list_queue"));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const unlisten = listen<ProgressEvent>("download-progress", (event) => {
      const p = event.payload;
      setQueue((items) =>
        items.map((item) =>
          item.id === p.queue_id
            ? {
                ...item,
                status: p.status,
                progress: p.progress ?? item.progress,
                speed: p.speed ?? item.speed,
                eta: p.eta ?? item.eta,
                error: p.error ?? item.error,
              }
            : item,
        ),
      );
      if (p.status === "done") finishedRef.current?.();
    });
    return () => {
      unlisten.then((stop) => stop());
    };
  }, []);

  const run = useCallback(
    async (action: () => Promise<unknown>) => {
      try {
        await action();
        await refresh();
      } catch (e) {
        alert(String(e));
      }
    },
    [refresh],
  );

  const pause = useCallback(
    (id: string) => run(() => invoke("pause_download", { queueId: id })),
    [run],
  );
  const cancel = useCallback(
    (id: string) => run(() => invoke("cancel_download", { queueId: id })),
    [run],
  );
  const remove = useCallback(
    (id: string) => run(() => invoke("remove_download", { queueId: id })),
    [run],
  );
  const clearFinished = useCallback(
    () => run(() => invoke("clear_finished_downloads")),
    [run],
  );
  const resume = useCallback(
    (id: string, formatPref: string, downloadDir: string | null) => {
      if (!downloadDir) {
        alert("Pick a downloads folder in Settings first.");
        return;
      }
      run(() => invoke("resume_download", { queueId: id, formatPref, downloadDir }));
    },
    [run],
  );

  return { queue, refresh, pause, cancel, remove, clearFinished, resume };
}
