import { invoke } from "@tauri-apps/api/core";
import type { QueueItem, Video } from "../types";

interface Props {
  queue: QueueItem[];
  videos: Video[];
  onRefresh: () => void;
}

const speed = (raw: string | null) => {
  if (!raw) return "";
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return "";
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB/s` : `${Math.round(n / 1e3)} KB/s`;
};

const eta = (raw: string | null) => {
  if (!raw) return "";
  const n = Number(raw);
  if (!isFinite(n) || n <= 0) return "";
  const m = Math.floor(n / 60);
  const s = Math.round(n % 60);
  return m > 0 ? `${m}m ${s}s left` : `${s}s left`;
};

const label = (status: string) =>
  status === "queued" ? "Queued"
  : status === "downloading" ? "Downloading"
  : status === "done" ? "Done"
  : status === "failed" ? "Failed"
  : status === "cancelled" ? "Cancelled"
  : status;

export default function Downloads({ queue, videos, onRefresh }: Props) {
  const cancel = async (id: string) => {
    await invoke("cancel_download", { queueId: id });
    onRefresh();
  };
  if (queue.length === 0) return <p className="empty">No downloads.</p>;
  return (
    <ul className="queue">
      {queue.map((q) => {
        const video = videos.find((v) => v.id === q.video_id);
        const active = q.status !== "done" && q.status !== "cancelled" && q.status !== "failed";
        return (
          <li key={q.id}>
            <div className="qmain">
              <span className="qtitle">{video?.title ?? "Download"}</span>
              <span className="qmeta">
                {speed(q.speed)}
                {q.speed && q.eta ? " · " : ""}
                {eta(q.eta)}
              </span>
            </div>
            <progress value={q.progress} max={100} />
            <span className={`qstatus ${q.status}`}>{label(q.status)}</span>
            {q.error && <span className="err" title={q.error}>{q.error.slice(0, 80)}</span>}
            {active && <button onClick={() => cancel(q.id)}>Cancel</button>}
          </li>
        );
      })}
    </ul>
  );
}
