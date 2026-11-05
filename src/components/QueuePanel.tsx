import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Video } from "../types";
import type { Player } from "../hooks/usePlayer";
import { displayTitle } from "../lib/display";
import { formatDuration } from "../lib/format";
import SourceIcon from "./SourceIcon";
import { CloseIcon } from "./icons";

interface Props {
  player: Player;
  onClose: () => void;
  /** Play a video from the panel without changing where autoplay continues. */
  onPlay: (video: Video) => void;
}

/**
 * The right-hand queue, as Spotify lays it out: now playing, the user's own
 * queue (reorder by dragging or with Alt+Up/Down), what follows from the
 * folder playback started in, and what already played.
 */
export default function QueuePanel({ player, onClose, onPlay }: Props) {
  const { current, queue, upNext, history } = player;
  return (
    <aside className="queue-panel" aria-label="Queue">
      <header className="queue-panel-head">
        <h2>Queue</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close the queue" title="Close (Q)">
          <CloseIcon size={12} />
        </button>
      </header>

      <div className="queue-panel-body">
        <Section title="Now playing">
          {current ? (
            <Row video={current} playing />
          ) : (
            <p className="queue-empty">Nothing is playing. Pick a video in the library.</p>
          )}
        </Section>

        <Section
          title="Next in your queue"
          action={queue.length > 0 ? <button className="link-button" onClick={player.clearQueue}>Clear</button> : null}
        >
          {queue.length === 0 ? (
            <p className="queue-empty">Use Play next or Add to queue on a video to line it up here.</p>
          ) : (
            <Reorderable videos={queue} player={player} onPlay={onPlay} />
          )}
        </Section>

        {upNext.length > 0 && (
          <Section title={`Next from ${player.contextLabel ?? "the library"}`}>
            <ol className="queue-list">
              {upNext.map((video) => (
                <Row key={video.id} video={video} onPlay={() => onPlay(video)} onQueue={() => player.enqueue(video)} />
              ))}
            </ol>
          </Section>
        )}

        {history.length > 0 && (
          <Section title="Previously played">
            <ol className="queue-list">
              {history.slice(0, 20).map((video) => (
                <Row key={video.id} video={video} faded onPlay={() => onPlay(video)} />
              ))}
            </ol>
          </Section>
        )}
      </div>
    </aside>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="queue-section">
      <div className="queue-section-head">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * The user's queue: drag a row onto another to take its place, or focus it
 * and press Alt+Up/Down. A drag only moves on drop; Esc or a drop outside
 * the list leaves the order alone.
 */
function Reorderable({ videos, player, onPlay }: { videos: Video[]; player: Player; onPlay: (video: Video) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const reset = () => {
    setDragging(null);
    setOver(null);
  };
  // React moves the focused row in the DOM; put focus back on it after.
  const moveByKey = (id: string, to: number) => {
    player.moveInQueue(id, to);
    requestAnimationFrame(() =>
      document.querySelector<HTMLButtonElement>(`[data-queue-id="${CSS.escape(id)}"] .queue-item-main`)?.focus(),
    );
  };

  return (
    <ol className="queue-list">
      {videos.map((video, index) => (
        <Row
          key={video.id}
          video={video}
          onPlay={() => onPlay(video)}
          onRemove={() => player.removeFromQueue(video.id)}
          draggable
          dropTarget={over === index && dragging !== video.id}
          onDragStart={() => setDragging(video.id)}
          onDragOver={() => setOver(index)}
          onDrop={() => {
            if (dragging !== null) player.moveInQueue(dragging, index);
            reset();
          }}
          onDragEnd={reset}
          onKeyMove={(delta) => moveByKey(video.id, index + delta)}
        />
      ))}
    </ol>
  );
}

interface RowProps {
  video: Video;
  playing?: boolean;
  faded?: boolean;
  onPlay?: () => void;
  onRemove?: () => void;
  onQueue?: () => void;
  draggable?: boolean;
  dropTarget?: boolean;
  onDragStart?: () => void;
  onDragOver?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
  onKeyMove?: (delta: number) => void;
}

function Row(props: RowProps) {
  const { video } = props;
  const title = displayTitle(video);
  return (
    <li
      className={"queue-item" + (props.playing ? " playing" : "") + (props.faded ? " faded" : "") + (props.dropTarget ? " drop" : "")}
      data-queue-id={video.id}
      draggable={props.draggable}
      onDrop={(event) => {
        event.preventDefault();
        props.onDrop?.();
      }}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        props.onDragStart?.();
      }}
      onDragOver={(event) => {
        if (!props.draggable) return;
        event.preventDefault();
        props.onDragOver?.();
      }}
      onDragEnd={props.onDragEnd}
    >
      <button
        className="queue-item-main"
        onClick={props.onPlay}
        disabled={!props.onPlay}
        title={props.onPlay ? `Play ${title}` : title}
        onKeyDown={(event) => {
          if (!props.onKeyMove || !event.altKey) return;
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            props.onKeyMove(event.key === "ArrowUp" ? -1 : 1);
          }
        }}
      >
        <span className="queue-thumb">
          {video.thumbnail_path ? (
            <img src={convertFileSrc(video.thumbnail_path)} alt="" loading="lazy" />
          ) : (
            <SourceIcon source={video.source} size={16} />
          )}
          {props.playing && <span className="eq" aria-label="Playing"><i /><i /><i /></span>}
        </span>
        <span className="queue-text">
          <span className="queue-title">{title}</span>
          <span className="queue-sub">
            {video.uploader ?? "Unknown"}
            {video.duration ? ` · ${formatDuration(video.duration)}` : ""}
          </span>
        </span>
      </button>
      {props.onQueue && (
        <button className="icon-button row-action" onClick={props.onQueue} aria-label={`Add ${title} to the queue`} title="Add to queue">
          +
        </button>
      )}
      {props.onRemove && (
        <button className="icon-button row-action" onClick={props.onRemove} aria-label={`Remove ${title} from the queue`} title="Remove">
          <CloseIcon size={10} />
        </button>
      )}
    </li>
  );
}
