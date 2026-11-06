interface IconProps {
  size?: number;
}

export function PlayIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export function PauseIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export function Back10Icon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4.5 9.5A8 8 0 1 1 4 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M4.5 4.5v5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" fontFamily="inherit">10</text>
    </svg>
  );
}

export function Forward10Icon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19.5 9.5A8 8 0 1 0 20 14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M19.5 4.5v5h-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <text x="12" y="16.2" textAnchor="middle" fontSize="6.5" fontWeight="700" fill="currentColor" fontFamily="inherit">10</text>
    </svg>
  );
}

export function VolumeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function MuteIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FullscreenIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PiPIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor" />
    </svg>
  );
}

export function QueueIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 6.5h11M4 12h11M4 17.5h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M16 14.2v5.6l4.4-2.8L16 14.2Z" fill="currentColor" />
    </svg>
  );
}

export function CloseIcon({ size = 12 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="m2 2 8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

// Navigation and toolbar icons: 16px outline, 1.5px stroke, one set.
const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function LibraryIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="2" />
      <path d="M4.5 13.75h7M7 5.5v3.5l3-1.75z" />
    </svg>
  );
}

/** The YouTube screen: a player tile, drawn in the nav's line style rather than the brand logo. */
export function YouTubeIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <rect x="1.5" y="3.25" width="13" height="9.5" rx="3" />
      <path d="M6.75 6v4l3.5-2z" fill="currentColor" />
    </svg>
  );
}

export function DownloadsIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M8 2v8M4.75 6.75 8 10l3.25-3.25M2.5 13.5h11" />
    </svg>
  );
}

export function SettingsIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </svg>
  );
}

export function FolderIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M1.75 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.75h5c.83 0 1.5.67 1.5 1.5v5.75c0 .83-.67 1.5-1.5 1.5h-9.5c-.83 0-1.5-.67-1.5-1.5z" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function LinkIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <path d="M6.75 9.25a2.5 2.5 0 0 0 3.54 0l2.47-2.47a2.5 2.5 0 0 0-3.54-3.54l-.7.7" />
      <path d="M9.25 6.75a2.5 2.5 0 0 0-3.54 0L3.24 9.22a2.5 2.5 0 0 0 3.54 3.54l.7-.7" />
    </svg>
  );
}

export function SearchIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" {...stroke}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </svg>
  );
}

// Player transport and view icons, filled or 1.7px stroke on a 24px grid.

export function PreviousIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="2.4" height="14" rx="1" />
      <path d="M18.5 5.9v12.2a1 1 0 0 1-1.55.83L8.6 13.2a1.4 1.4 0 0 1 0-2.4l8.35-5.73a1 1 0 0 1 1.55.83Z" />
    </svg>
  );
}

export function NextIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="16.6" y="5" width="2.4" height="14" rx="1" />
      <path d="M5.5 5.9v12.2a1 1 0 0 0 1.55.83l8.35-5.73a1.4 1.4 0 0 0 0-2.4L7.05 5.07A1 1 0 0 0 5.5 5.9Z" />
    </svg>
  );
}

export function RepeatIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3.5 20 6.5l-3 3" />
      <path d="M4 11.5v-1a4 4 0 0 1 4-4h12" />
      <path d="M7 20.5 4 17.5l3-3" />
      <path d="M20 12.5v1a4 4 0 0 1-4 4H4" />
    </svg>
  );
}

export function AutoplayIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.5" y="7" width="19" height="10" rx="5" />
      <path d="M10 10v4l3.5-2z" fill="currentColor" />
    </svg>
  );
}

export function ExpandIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
    </svg>
  );
}

export function MinimizeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <rect x="11.5" y="11.5" width="6.5" height="4.5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function SidebarIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" />
      <path d="M6 3v10" />
    </svg>
  );
}

export function FinderIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4.25c0-.83.67-1.5 1.5-1.5h3l1.5 1.75h4.5c.83 0 1.5.67 1.5 1.5v5.75c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5z" />
      <path d="m7 9.5 1.5 1.5L11 8.5" />
    </svg>
  );
}
