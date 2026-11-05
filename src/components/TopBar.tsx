import { useState } from "react";
import type { Format, QueueEntry } from "../types";
import { looksLikeUrl } from "../lib/enqueue";
import { FORMAT_OPTIONS, urlBoxFormat } from "../lib/downloadFormats";
import { intakeSummary } from "../lib/queueGroups";
import Brand from "./Brand";
import SourceIcon from "./SourceIcon";
import { LinkIcon } from "./icons";

interface Props {
  queue: QueueEntry[];
  /** From Settings; null until they have loaded. */
  defaultFormat: Format | null;
  /**
   * Resolves to true when the URL was accepted (the field then clears).
   * `format` is null unless the user picked one here: the backend applies
   * the Settings default itself (ADR 0006), so a paste made before the
   * settings load cannot fall back to the wrong format.
   */
  onSubmit: (url: string, format: Format | null) => Promise<boolean>;
  onOpenDownloads: () => void;
}

/**
 * The window's top bar, which is also its drag region: the mark, the paste
 * box (the app's main job, one click from every screen) and the intake, a
 * live view of what is downloading right now.
 */
export default function TopBar({ queue, defaultFormat, onSubmit, onOpenDownloads }: Props) {
  return (
    <header className="topbar" data-tauri-drag-region>
      <Brand />
      <UrlBox defaultFormat={defaultFormat} onSubmit={onSubmit} />
      <Intake queue={queue} onOpen={onOpenDownloads} />
    </header>
  );
}

function UrlBox({ defaultFormat, onSubmit }: Pick<Props, "defaultFormat" | "onSubmit">) {
  const [url, setUrl] = useState("");
  // null follows the default from Settings until the user picks one here.
  const [format, setFormat] = useState<Format | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = looksLikeUrl(url);
  const shownFormat = urlBoxFormat(format, defaultFormat);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (await onSubmit(url.trim(), shownFormat.send)) setUrl("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={"urlbox" + (busy ? " busy" : "")}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label className="urlbox-field">
        <LinkIcon />
        <input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="Paste a video, playlist or channel link"
          aria-label="Video, playlist or channel URL"
          spellCheck={false}
          autoCorrect="off"
          disabled={busy}
        />
        <select
          aria-label="Format"
          value={shownFormat.shown}
          onChange={(event) => setFormat(event.target.value as Format)}
          disabled={busy}
        >
          {shownFormat.shown === "" && (
            <option value="" disabled>
              Default
            </option>
          )}
          {FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.short}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="primary" disabled={!valid || busy}>
        {busy ? "Looking it up…" : "Download"}
      </button>
    </form>
  );
}

function Intake({ queue, onOpen }: { queue: QueueEntry[]; onOpen: () => void }) {
  const summary = intakeSummary(queue);
  return (
    <button
      className={"intake" + (summary.active > 0 ? " live" : "")}
      onClick={onOpen}
      aria-label={`Downloads: ${summary.label}`}
    >
      {summary.current ? <SourceIcon source={summary.current.source} size={14} /> : null}
      <span className="intake-text">
        <span className="intake-label">{summary.label}</span>
        {summary.current && <span className="intake-title">{summary.current.title}</span>}
      </span>
      {summary.active > 0 && (
        <span className="intake-meter" aria-hidden="true">
          <span style={{ transform: `scaleX(${summary.progress / 100})` }} />
        </span>
      )}
    </button>
  );
}
