import { useState } from "react";
import type { Format, View } from "../types";
import { looksLikeUrl } from "../lib/enqueue";
import { FORMAT_OPTIONS } from "../lib/downloadFormats";

interface Props {
  view: View;
  onNavigate: (view: View) => void;
  /** Active downloads, shown as a badge next to Downloads. */
  activeDownloads: number;
  defaultFormat: Format;
  /** Resolves to true when the URL was accepted (the field then clears). */
  onSubmit: (url: string, format: Format) => Promise<boolean>;
}

const NAV: { view: View; label: string }[] = [
  { view: "library", label: "Library" },
  { view: "downloads", label: "Downloads" },
  { view: "settings", label: "Settings" },
];

export default function Sidebar({ view, onNavigate, activeDownloads, defaultFormat, onSubmit }: Props) {
  const [url, setUrl] = useState("");
  // null follows the default from Settings until the user picks one here.
  const [format, setFormat] = useState<Format | null>(null);
  const [busy, setBusy] = useState(false);
  const valid = looksLikeUrl(url);

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      if (await onSubmit(url.trim(), format ?? defaultFormat)) setUrl("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="sidebar">
      <nav>
        {NAV.map((item) => (
          <button
            key={item.view}
            className={view === item.view ? "active" : ""}
            aria-current={view === item.view ? "page" : undefined}
            onClick={() => onNavigate(item.view)}
          >
            {item.label}
            {item.view === "downloads" && activeDownloads > 0 && (
              <span className="nav-badge" aria-label={`${activeDownloads} active`}>
                {activeDownloads}
              </span>
            )}
          </button>
        ))}
      </nav>
      <form
        className="urlbox"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="urlbox-label" htmlFor="url-input">
          Video, playlist or channel URL
        </label>
        <input
          id="url-input"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://…"
          spellCheck={false}
          autoCorrect="off"
          disabled={busy}
        />
        <select
          aria-label="Format"
          value={format ?? defaultFormat}
          onChange={(event) => setFormat(event.target.value as Format)}
          disabled={busy}
        >
          {FORMAT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.short}
            </option>
          ))}
        </select>
        <button type="submit" disabled={!valid || busy}>
          {busy ? "Looking it up…" : "Download"}
        </button>
      </form>
    </aside>
  );
}
