/**
 * Yank's mark: a stream pulled down into a tray, the one thing the app does.
 * Drawn in the data hue, the only place that hue appears in the chrome.
 */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="mark">
      <rect width="24" height="24" rx="7" fill="var(--accent)" />
      <path
        d="M12 5.5v8.25M8.25 10.25 12 14l3.75-3.75M6.5 17.25h11"
        fill="none"
        stroke="#0b0d04"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Brand() {
  return (
    <div className="brand" data-tauri-drag-region>
      <Mark />
      <span className="brand-name" data-tauri-drag-region>
        Yank
      </span>
    </div>
  );
}
