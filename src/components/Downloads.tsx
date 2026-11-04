import { useState } from "react";
import { api } from "../api";
import { copyText } from "../lib/clipboard";
import { displayTitle } from "../lib/display";
import { formatEta, formatSpeed } from "../lib/format";
import { attempt, notify } from "../lib/notify";
import {
  STATUS_LABEL,
  errorHeadline,
  groupProgress,
  groupQueue,
  groupSummary,
  isActive,
  isFinished,
  type QueueGroup,
} from "../lib/queueGroups";
import type { QueueEntry } from "../types";
import SourceIcon from "./SourceIcon";

/** Every queue action the view can trigger, by queue id. */
export interface QueueActions {
  pause: (id: string) => void;
  resume: (id: string) => void;
  cancel: (id: string) => void;
  remove: (id: string) => void;
  clearFinished: () => void;
  pauseAll: () => void;
  resumeAll: () => void;
  retryFailed: () => void;
}

interface Props {
  queue: QueueEntry[];
  actions: QueueActions;
}

export default function Downloads({ queue, actions }: Props) {
  if (queue.length === 0) {
    return (
      <p className="empty">
        Nothing downloading. Paste a video, playlist or channel URL in the sidebar.
      </p>
    );
  }

  const count = (test: (entry: QueueEntry) => boolean) => queue.filter(test).length;
  const active = count((e) => isActive(e.status));
  const paused = count((e) => e.status === "paused");
  const failed = count((e) => e.status === "failed");
  const finished = count((e) => isFinished(e.status));

  return (
    <>
      <div className="queue-head">
        {active > 0 && <button onClick={actions.pauseAll}>Pause all</button>}
        {paused > 0 && <button onClick={actions.resumeAll}>Resume all ({paused})</button>}
        {failed > 0 && <button onClick={actions.retryFailed}>Retry failed ({failed})</button>}
        {finished > 0 && <button onClick={actions.clearFinished}>Clear finished</button>}
      </div>
      {groupQueue(queue).map((group) =>
        group.title === null ? (
          <ul className="queue" key={group.key}>
            <QueueRow entry={group.entries[0]} actions={actions} />
          </ul>
        ) : (
          <PlaylistGroup key={group.key} group={group} actions={actions} />
        ),
      )}
    </>
  );
}

function PlaylistGroup({ group, actions }: { group: QueueGroup; actions: QueueActions }) {
  return (
    <section className="queue-group" aria-label={group.title ?? undefined}>
      <header className="queue-group-head">
        <div className="qmain">
          <span className="qtitle">{group.title}</span>
          <span className="qmeta">{groupSummary(group)}</span>
        </div>
        <Meter value={groupProgress(group)} label="Playlist progress" />
      </header>
      <ul className="queue">
        {group.entries.map((entry) => (
          <QueueRow key={entry.id} entry={entry} actions={actions} />
        ))}
      </ul>
    </section>
  );
}

function QueueRow({ entry, actions }: { entry: QueueEntry; actions: QueueActions }) {
  const [expanded, setExpanded] = useState(false);
  const { status } = entry;
  const failed = status === "failed";
  const title = displayTitle(entry);

  const copyDiagnostics = async () => {
    const text = await attempt(() => api.downloadDiagnostics(entry.id));
    if (text && (await attempt(() => copyText(text))) !== undefined) {
      notify.info("Diagnostics copied.");
    }
  };

  return (
    <li className={`queue-row is-${status}`}>
      <div className="queue-line">
        <SourceIcon source={entry.source} size={15} />
        <div className="qmain">
          <span className="qtitle" title={title}>
            {title}
          </span>
          <span className="qmeta">{rowMeta(entry)}</span>
        </div>
        <Meter value={entry.progress} label={`${title} progress`} done={status === "done"} />
        <span className={`qstatus ${status}`}>{STATUS_LABEL[status]}</span>
        <div className="qactions">
          {isActive(status) && <button onClick={() => actions.pause(entry.id)}>Pause</button>}
          {isActive(status) && <button onClick={() => actions.cancel(entry.id)}>Cancel</button>}
          {status === "paused" && <button onClick={() => actions.resume(entry.id)}>Resume</button>}
          {failed && <button onClick={() => actions.resume(entry.id)}>Retry</button>}
          {(status === "paused" || isFinished(status)) && (
            <button onClick={() => actions.remove(entry.id)}>Remove</button>
          )}
        </div>
      </div>
      {failed && entry.error && (
        <div className="queue-error">
          <button
            className="queue-error-toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded((open) => !open)}
          >
            <span className="err">{errorHeadline(entry.error)}</span>
            <span className="queue-error-more">{expanded ? "Hide details" : "Details"}</span>
          </button>
          {expanded && (
            <>
              <pre className="queue-error-log">{entry.error}</pre>
              <button onClick={copyDiagnostics}>Copy diagnostics</button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** A progress bar: the filled part carries the data hue; done rows stay grey. */
function Meter({ value, label, done = false }: { value: number; label: string; done?: boolean }) {
  return (
    <span
      className={"meter" + (done ? " done" : "")}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span style={{ transform: `scaleX(${Math.min(100, Math.max(0, value)) / 100})` }} />
    </span>
  );
}

function rowMeta(entry: QueueEntry): string {
  switch (entry.status) {
    case "downloading":
      return [formatSpeed(entry.speed), formatEta(entry.eta)].filter(Boolean).join(" · ") || "Starting…";
    case "queued":
      return "Waiting for a free slot";
    case "paused":
      return "Resumes where it left off";
    case "done":
      return entry.format === "audio" ? "Audio" : "";
    default:
      return "";
  }
}
