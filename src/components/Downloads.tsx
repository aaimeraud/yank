import type { QueueItem } from "../types";

interface Props { queue: QueueItem[]; }

export default function Downloads({ queue }: Props) {
  if (queue.length === 0) return <p className="empty">No downloads.</p>;
  return (
    <ul className="queue">
      {queue.map((q) => (
        <li key={q.id}>
          <span>{q.status}</span>
          <progress value={q.progress} max={100} />
          <span>{q.progress.toFixed(0)}%</span>
          {q.speed && <span className="muted">{q.speed}</span>}
          {q.error && <span className="err">{q.error}</span>}
        </li>
      ))}
    </ul>
  );
}