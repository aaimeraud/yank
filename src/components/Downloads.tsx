import { invoke } from "@tauri-apps/api/core";
import type { QueueItem, Video } from "../types";

interface Props {
  queue: QueueItem[];
  videos: Video[];
  onRefresh: () => void;
  downloadDir: string | null;
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
  : status === "paused" ? "Paused"
  : status === "done" ? "Done"
  : status === "failed" ? "Failed"
  : status === "cancelled" ? "Cancelled"
  : status;

export default function Downloads({ queue, videos, onRefresh, downloadDir }: Props) {
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
      onRefresh();
    } catch (e) {
      alert(String(e));
    }
  };

  const pause = (id: string) => run(() => invoke("pause_download", { queueId: id }));
  const cancel = (id: string) => run(() => invoke("cancel_download", { queueId: id }));
  const remove = (id: string) => run(() => invoke("remove_download", { queueId: id }));
  const resume = (id: string) => {
    if (!downloadDir) {
      alert("Pick a downloads folder in Settings first.");
      return;
    }
    run(() => invoke("resume_download", { queueId: id, formatPref: "video", downloadDir }));
  };

  if (queue.length === 0) return <p className="empty">No downloads.</p>;

  const hasFinished = queue.some(
    (q) => q.status === "done" || q.status === "failed" || q.status === "cancelled",
  );

  return (
    <>
      {hasFinished && (
        <div className="queue-head">
          <button onClick={() => run(() => invoke("clear_finished_downloads"))}>
            Clear finished
          </button>
        </div>
      )}
      <ul className="queue">
        {queue.map((q) => {
          const video = videos.find((v) => v.id === q.video_id);
          const isActive = q.status === "queued" || q.status === "downloading";
          const isPaused = q.status === "paused";
          const isFailed = q.status === "failed";
          const isFinished = q.status === "done" || isFailed || q.status === "cancelled";
          const meta =
            q.status === "downloading"
              ? [speed(q.speed), eta(q.eta)].filter(Boolean).join(" · ")
              : q.status === "queued"
                ? "Waiting for a slot"
                : q.status === "paused"
                  ? "Resumes where it left off"
                  : "";
          return (
            <li key={q.id}>
              <div className="qmain">
                <span className="qtitle">{video?.title ?? "Download"}</span>
                <span className="qmeta">{meta}</span>
              </div>
              <progress value={q.progress} max={100} />
              <span className={`qstatus ${q.status}`}>{label(q.status)}</span>
              {q.error && <span className="err" title={q.error}>{q.error.slice(0, 80)}</span>}
              {isActive && <button onClick={() => pause(q.id)}>Pause</button>}
              {isActive && <button onClick={() => cancel(q.id)}>Cancel</button>}
              {isPaused && <button onClick={() => resume(q.id)}>Resume</button>}
              {isFailed && <button onClick={() => resume(q.id)}>Retry</button>}
              {(isPaused || isFinished) && <button onClick={() => remove(q.id)}>Remove</button>}
            </li>
          );
        })}
      </ul>
    </>
  );
}
