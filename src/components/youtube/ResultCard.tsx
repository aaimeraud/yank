import { useRef, useState } from "react";
import type { Format, SearchResult } from "../../types";
import { useDismiss } from "../../hooks/useDismiss";
import { FORMAT_OPTIONS } from "../../lib/downloadFormats";
import { formatTransfer } from "../../lib/format";
import { downloadBlocker, isLive, isUnavailable, resultBadge, resultMeta, watchBlocker, type HitState } from "../../lib/youtube";
import SourceIcon from "../SourceIcon";
import { PlayIcon } from "../icons";

/** What a hit can ask the screen to do. */
export interface HitActions {
  /** Stream it, play the file when it is downloaded, or open a playlist. */
  open: (hit: SearchResult) => void;
  /** Stream a whole playlist from its first video. */
  playAll: (hit: SearchResult) => void;
  /** Null format: the default from Settings. */
  download: (hit: SearchResult, format: Format | null) => void;
  copyLink: (hit: SearchResult) => void;
}

interface Props {
  hit: SearchResult;
  index: number;
  state: HitState;
  /** This hit is in the player right now. */
  playing: boolean;
  actions: HitActions;
}

/**
 * A search hit, drawn like a library card so the two screens read as one
 * app: thumbnail with its corner label, title, channel and views. Clicking
 * watches it; Download and the menu are on the thumbnail.
 */
export default function ResultCard({ hit, index, state, playing, actions }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const unavailable = isUnavailable(hit);
  const blockedWatch = unavailable ? "This video is private or was deleted." : watchBlocker(hit);
  const blockedDownload = unavailable ? blockedWatch : downloadBlocker(hit);
  const playlist = hit.kind === "playlist";

  const activate = () => {
    if (menuOpen) setMenuOpen(false);
    else if (!blockedWatch) actions.open(hit);
  };

  const classes = ["card", "hit"];
  if (menuOpen) classes.push("menu-open");
  if (playlist) classes.push("is-playlist");
  if (playing) classes.push("playing");
  if (state.kind === "downloading") classes.push("incoming");
  if (blockedWatch) classes.push("missing");

  const verb = playlist ? "Open" : state.kind === "downloaded" ? "Play" : "Watch";
  return (
    <div
      className={classes.join(" ")}
      style={{ "--enter-delay": `${Math.min(index, 11) * 45}ms` } as React.CSSProperties}
      role="button"
      tabIndex={0}
      aria-label={`${verb} ${hit.title}`}
      aria-disabled={blockedWatch ? true : undefined}
      title={blockedWatch ?? undefined}
      onClick={activate}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuOpen(true);
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      }}
    >
      <div className={"thumb" + (hit.thumbnail ? " has-img" : "")}>
        <HitImage hit={hit} />
        {!blockedWatch && (
          <span className="hit-play" aria-hidden="true">
            <PlayIcon size={20} />
          </span>
        )}
        {state.kind === "downloading" ? (
          <div className="thumb-download" role="progressbar" aria-valuenow={Math.round(state.entry.progress)} aria-valuemin={0} aria-valuemax={100} aria-label="Download progress">
            <span className="thumb-download-text">
              {state.entry.status === "queued"
                ? "Waiting for a slot"
                : state.entry.status === "paused"
                  ? `Paused at ${Math.round(state.entry.progress)}%`
                  : `${Math.round(state.entry.progress)}%  ${formatTransfer(state.entry.speed, state.entry.eta)}`}
            </span>
            <span className="thumb-download-bar">
              <span style={{ transform: `scaleX(${state.entry.progress / 100})` }} />
            </span>
          </div>
        ) : (
          resultBadge(hit) && (
            <span className={"thumb-duration" + (isLive(hit) ? " is-live" : "")}>
              {isLive(hit) && <span className="live-dot" aria-hidden="true" />}
              {resultBadge(hit)}
            </span>
          )
        )}
        {state.kind === "downloaded" && <span className="thumb-watched">In library</span>}
      </div>

      {playing && (
        <span className="card-playing">
          <span className="eq" aria-hidden="true"><i /><i /><i /></span>
          Playing
        </span>
      )}

      {state.kind === "none" && !blockedDownload && (
        <button
          className="card-download"
          onClick={(event) => {
            event.stopPropagation();
            actions.download(hit, null);
          }}
          title={playlist ? "Download every video of this playlist into its own folder" : "Download with the format from Settings"}
        >
          {playlist ? "Download all" : "Download"}
        </button>
      )}

      <HitMenu
        hit={hit}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        canWatch={!blockedWatch}
        canDownload={!blockedDownload && state.kind === "none"}
        actions={actions}
      />

      <div className="title" title={hit.title}>
        {hit.title}
      </div>
      <div className="meta">
        <SourceIcon source="youtube" size={12} />
        <span>{blockedWatch && !unavailable ? blockedWatch : resultMeta(hit)}</span>
      </div>
    </div>
  );
}

function HitImage({ hit }: { hit: SearchResult }) {
  const [broken, setBroken] = useState(false);
  if (!hit.thumbnail || broken) {
    return (
      <span className="thumb-placeholder">
        <SourceIcon source="youtube" size={28} />
      </span>
    );
  }
  return <img src={hit.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />;
}

interface MenuProps {
  hit: SearchResult;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWatch: boolean;
  canDownload: boolean;
  actions: HitActions;
}

function HitMenu({ hit, open, onOpenChange, canWatch, canDownload, actions }: MenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => onOpenChange(false));
  const pick = (action: () => void) => () => {
    onOpenChange(false);
    action();
  };
  const playlist = hit.kind === "playlist";
  return (
    <div className="card-menu-wrap" ref={ref} onClick={(event) => event.stopPropagation()}>
      <button
        className={"card-menu-btn" + (open ? " open" : "")}
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        ⋯
      </button>
      {open && (
        <div className="card-menu" role="menu">
          {canWatch && (
            <button role="menuitem" onClick={pick(() => actions.open(hit))}>
              {playlist ? "Open playlist" : "Watch"}
            </button>
          )}
          {playlist && (
            <button role="menuitem" onClick={pick(() => actions.playAll(hit))}>Play all</button>
          )}
          {canDownload && (
            <>
              <div className="menu-sep" />
              <span className="menu-label">{playlist ? "Download all as" : "Download as"}</span>
              {FORMAT_OPTIONS.map((option) => (
                <button role="menuitem" key={option.value} onClick={pick(() => actions.download(hit, option.value))}>
                  {option.label}
                </button>
              ))}
            </>
          )}
          <div className="menu-sep" />
          <button role="menuitem" onClick={pick(() => actions.copyLink(hit))}>Copy link</button>
        </div>
      )}
    </div>
  );
}
