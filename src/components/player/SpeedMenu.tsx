import { useEffect, useRef, useState } from "react";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

interface Props {
  speed: number;
  onChange: (speed: number) => void;
}

/** The playback speed, picked from a short list instead of cycled blind. */
export default function SpeedMenu({ speed, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="vv-menu-wrap" ref={ref}>
      <button
        className={"vv-speed" + (speed !== 1 ? " changed" : "")}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Playback speed ${speed}×`}
        title="Playback speed"
      >
        {speed}×
      </button>
      {open && (
        <div className="vv-menu" role="menu" aria-label="Playback speed">
          {SPEEDS.map((value) => (
            <button
              key={value}
              role="menuitemradio"
              aria-checked={value === speed}
              className={value === speed ? "current" : undefined}
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
            >
              {value === 1 ? "Normal" : `${value}×`}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
