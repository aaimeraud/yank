import { useState } from "react";
import { formatClock } from "../../lib/format";

interface Props {
  position: number;
  duration: number;
  onSeek: (seconds: number) => void;
  /** "accent" for the timeline, "white" for volume-like ranges. */
  tone?: "accent" | "white";
  max?: number;
  step?: number;
  label: string;
  className?: string;
  /** Show the time under the pointer while hovering (the timeline only). */
  hoverTime?: boolean;
}

/**
 * A range input over a drawn track. The played part is data, so it takes
 * the accent; the input itself only draws the thumb and keeps keyboard use.
 */
export default function SeekBar({
  position,
  duration,
  onSeek,
  tone = "accent",
  max,
  step = 0.1,
  label,
  className = "",
  hoverTime = false,
}: Props) {
  const [hover, setHover] = useState<{ x: number; time: number } | null>(null);
  const top = max ?? duration;
  const ratio = top > 0 ? Math.min(1, Math.max(0, position / top)) : 0;

  return (
    <span
      className={`vv-range ${tone === "accent" ? "accent" : ""} ${className}`}
      onMouseMove={(event) => {
        if (!hoverTime || duration <= 0) return;
        const box = event.currentTarget.getBoundingClientRect();
        const x = Math.min(box.width, Math.max(0, event.clientX - box.left));
        setHover({ x, time: (x / box.width) * duration });
      }}
      onMouseLeave={() => setHover(null)}
    >
      <span className="vv-range-fill" style={{ transform: `scaleX(${ratio})` }} />
      <input
        type="range"
        min={0}
        max={top || 0}
        step={step}
        value={Math.min(position, top || 0)}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label={label}
        aria-valuetext={hoverTime ? `${formatClock(position)} of ${formatClock(duration)}` : undefined}
      />
      {hover && (
        <span className="vv-range-tip" style={{ left: hover.x }}>
          {formatClock(hover.time)}
        </span>
      )}
    </span>
  );
}
