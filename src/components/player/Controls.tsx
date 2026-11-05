import { formatClock } from "../../lib/format";
import {
  AutoplayIcon,
  Back10Icon,
  Forward10Icon,
  FullscreenIcon,
  MinimizeIcon,
  MuteIcon,
  NextIcon,
  PauseIcon,
  PiPIcon,
  PlayIcon,
  PreviousIcon,
  QueueIcon,
  RepeatIcon,
  VolumeIcon,
} from "../icons";
import SeekBar from "./SeekBar";
import SpeedMenu from "./SpeedMenu";
import type { Playback } from "./usePlayback";

export interface TransportProps {
  playback: Playback;
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}

/** Previous, play/pause, next: shared by the full and the mini player. */
export function Transport({ playback, canPrevious, canNext, onPrevious, onNext }: TransportProps) {
  return (
    <>
      <button
        onClick={onPrevious}
        aria-label={canPrevious ? "Previous video" : "Restart"}
        title="Previous (Shift+P)"
      >
        <PreviousIcon />
      </button>
      <button className="vv-primary" onClick={playback.toggle} aria-label={playback.playing ? "Pause" : "Play"}>
        {playback.playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </button>
      <button onClick={onNext} disabled={!canNext} aria-label="Next video" title="Next (Shift+N)">
        <NextIcon />
      </button>
    </>
  );
}

interface Props extends TransportProps {
  autoplay: boolean;
  repeat: boolean;
  queueOpen: boolean;
  onToggleAutoplay: () => void;
  onToggleRepeat: () => void;
  onToggleQueue: () => void;
  onMinimize: () => void;
  onPictureInPicture: () => void;
  onFullscreen: () => void;
}

/** The full player's control bar. Toggles that are on carry the white fill. */
export default function Controls(props: Props) {
  const { playback } = props;
  return (
    <div className="vv-controls">
      <SeekBar
        className="vv-seek"
        position={playback.position}
        duration={playback.duration}
        onSeek={playback.seek}
        label="Seek"
        hoverTime
      />
      <div className="vv-control-row">
        <div className="vv-group">
          <Transport {...props} />
          <button onClick={() => playback.skip(-10)} aria-label="Back 10 seconds" title="Back 10s (←)">
            <Back10Icon size={20} />
          </button>
          <button onClick={() => playback.skip(10)} aria-label="Forward 10 seconds" title="Forward 10s (→)">
            <Forward10Icon size={20} />
          </button>
          <span className="vv-time">
            {formatClock(playback.position)} <span>/ {formatClock(playback.duration)}</span>
          </span>
        </div>
        <div className="vv-group">
          <div className="vv-volume">
            <button onClick={playback.toggleMute} aria-label={playback.muted ? "Unmute" : "Mute"} title="Mute (M)">
              {playback.muted || playback.volume === 0 ? <MuteIcon size={18} /> : <VolumeIcon size={18} />}
            </button>
            <SeekBar
              tone="white"
              position={playback.muted ? 0 : playback.volume}
              duration={1}
              max={1}
              step={0.01}
              onSeek={playback.setVolume}
              label="Volume"
            />
          </div>
          <SpeedMenu speed={playback.speed} onChange={playback.setSpeed} />
          <Toggle on={props.autoplay} onClick={props.onToggleAutoplay} label="Autoplay" title="Autoplay the next video">
            <AutoplayIcon />
          </Toggle>
          <Toggle on={props.repeat} onClick={props.onToggleRepeat} label="Repeat this video" title="Repeat">
            <RepeatIcon />
          </Toggle>
          <Toggle on={props.queueOpen} onClick={props.onToggleQueue} label="Queue" title="Queue (Q)">
            <QueueIcon />
          </Toggle>
          <button onClick={props.onMinimize} aria-label="Mini player" title="Mini player (I)">
            <MinimizeIcon />
          </button>
          <button onClick={props.onPictureInPicture} aria-label="Picture in picture" title="Picture in picture">
            <PiPIcon size={18} />
          </button>
          <button onClick={props.onFullscreen} aria-label="Fullscreen" title="Fullscreen (F)">
            <FullscreenIcon size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle(props: { on: boolean; onClick: () => void; label: string; title: string; children: React.ReactNode }) {
  return (
    <button
      className={"vv-toggle" + (props.on ? " on" : "")}
      onClick={props.onClick}
      aria-label={props.label}
      aria-pressed={props.on}
      title={props.title}
    >
      {props.children}
    </button>
  );
}
