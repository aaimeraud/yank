import type { Video } from "../../types";
import { displayTitle } from "../../lib/display";
import { CloseIcon, ExpandIcon, QueueIcon } from "../icons";
import { Transport, type TransportProps } from "./Controls";

interface Props extends TransportProps {
  video: Video;
  queueOpen: boolean;
  onExpand: () => void;
  onClose: () => void;
  onToggleQueue: () => void;
}

/** Under the mini player's picture: what plays, and the few controls that fit. */
export default function MiniBar({ video, queueOpen, onExpand, onClose, onToggleQueue, ...transport }: Props) {
  const { playback } = transport;
  const ratio = playback.duration > 0 ? playback.position / playback.duration : 0;
  return (
    <div className="mini-bar">
      <span className="mini-progress" aria-hidden="true">
        <span style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <button className="mini-title" onClick={onExpand} title="Back to the player">
        <span>{displayTitle(video)}</span>
        <span className="mini-sub">{video.uploader ?? "Unknown"}</span>
      </button>
      <div className="mini-controls">
        <Transport {...transport} />
        <button
          className={"vv-toggle" + (queueOpen ? " on" : "")}
          onClick={onToggleQueue}
          aria-label="Queue"
          aria-pressed={queueOpen}
        >
          <QueueIcon size={16} />
        </button>
        <button onClick={onExpand} aria-label="Expand the player">
          <ExpandIcon size={16} />
        </button>
        <button onClick={onClose} aria-label="Close the player">
          <CloseIcon size={12} />
        </button>
      </div>
    </div>
  );
}
