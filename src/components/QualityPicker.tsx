import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { formatBytes } from "../lib/format";
import { errorMessage } from "../lib/notify";
import type { Format, QualityChoice } from "../types";

interface Props {
  url: string;
  onPick: (format: Format) => void;
  onCancel: () => void;
}

/** Choose what to download, knowing how much disk each choice takes. */
export default function QualityPicker({ url, onPick, onCancel }: Props) {
  const [choice, setChoice] = useState<QualityChoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstRow = useRef<HTMLButtonElement>(null);
  // Enter should take the best file the built-in player can open.
  const firstPlayable = Math.max(0, choice?.options.findIndex((option) => option.plays_in_app) ?? 0);

  useEffect(() => {
    let current = true;
    api.listQualities(url).then(
      (result) => current && setChoice(result),
      (failure) => current && setError(errorMessage(failure)),
    );
    return () => {
      current = false;
    };
  }, [url]);

  useEffect(() => firstRow.current?.focus(), [choice]);

  // Modal for the keyboard too: Tab cannot reach what is behind the dialog.
  useEffect(() => {
    const behind = [...document.querySelectorAll(".topbar, .workspace")];
    behind.forEach((element) => element.setAttribute("inert", ""));
    return () => behind.forEach((element) => element.removeAttribute("inert"));
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="dialog-scrim" onClick={onCancel}>
      <div
        className="dialog quality-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a quality"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dialog-head">
          <h2>Choose a quality</h2>
          {choice && <p title={choice.title}>{choice.title}</p>}
        </header>
        {error ? (
          <p className="dialog-error" role="alert">{error}</p>
        ) : !choice ? (
          <p className="dialog-loading" role="status">
            <span className="spinner" aria-hidden="true" /> Looking up the available qualities…
          </p>
        ) : (
          <>
            <ul className="quality-list">
              {choice.options.map((option, index) => (
                <li key={option.format}>
                  <button ref={index === firstPlayable ? firstRow : undefined} onClick={() => onPick(option.format)}>
                    <span className="quality-name">{option.label}</span>
                    <span className="quality-detail">
                      {option.detail}
                      {!option.plays_in_app && " · may need another player"}
                    </span>
                    <span className="quality-size">{sizeText(option.size, option.approximate, choice.is_playlist)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {choice.is_playlist && <p className="dialog-note">Sizes depend on each video of the playlist.</p>}
          </>
        )}
        <footer className="dialog-foot">
          <button onClick={onCancel}>Cancel</button>
        </footer>
      </div>
    </div>
  );
}

export function sizeText(size: number | null, approximate: boolean, isPlaylist: boolean): string {
  if (isPlaylist) return "";
  if (size === null) return "Size unknown";
  return (approximate ? "~" : "") + formatBytes(size);
}
