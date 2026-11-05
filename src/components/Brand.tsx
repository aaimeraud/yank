import { useId } from "react";
import { Y_GLYPH, Y_ON_TILE } from "./brandPaths";

/**
 * Yank's mark: the app icon itself, a script "y" on a rounded tile. Always the
 * light icon (pink tile, white "y"): the dark icon is made for the Dock and a
 * wallpaper, and on this true-black bar its tile vanishes and its pink hairline
 * blurs. The Dock icon and the favicon still switch with the system appearance
 * (src-tauri/icons/yank.icon, public/yank.svg).
 */
function Mark({ size = 30 }: { size?: number }) {
  const clip = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" role="img" aria-label="Yank" className="mark">
      <defs>
        <clipPath id={clip}>
          <rect width="1024" height="1024" rx="232" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${CSS.escape(clip)})`}>
        <rect width="1024" height="1024" fill="var(--accent)" />
        <path d={Y_GLYPH} transform={Y_ON_TILE} fill="#ffffff" />
      </g>
    </svg>
  );
}

export default function Brand() {
  return (
    <div className="brand" data-tauri-drag-region>
      <Mark />
    </div>
  );
}
