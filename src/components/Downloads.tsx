import { invoke } from "@tauri-apps/api/core";
import type { QueueItem } from "../types";

interface Props { queue: QueueItem[]; onRefresh: () => void; }

export default function Downloads({ queue, onRefresh }: Props) {
  const cancel = async (id: string) => { await invoke("cancel_download", { queueId: id }); onRefresh(); };
  if (queue.length === 0) return <p className="empty">No downloads.</p>;
  return (
    <ul className="queue">
      {queue.map((q) => (
        <li key={q.id}>
          <span>{q.status}</span>
          <progress value={q.progress} max={100} />
          <span>{q.progress.toFixed(0)}%</span>
          {q.speed && <span className="muted">{q.speed}</span>}
          {q.error && <span className="err" title={q.error}>{q.error.slice(0, 60)}</span>}
          {q.status !== "done" && q.status !== "cancelled" && (
            <button onClick={() => cancel(q.id)}>Cancel</button>
          )}
        </li>
      ))}
    </ul>
  );
}