import youtubeIcon from "../assets/youtube.svg";
import twitchIcon from "../assets/twitch.svg";
import xIcon from "../assets/X (formerly Twitter)_light_dark/X (formerly Twitter)_dark.svg";

const icons: Record<string, string> = {
  youtube: youtubeIcon,
  twitch: twitchIcon,
  x: xIcon,
};

export type SourceKey = "youtube" | "twitch" | "x" | "other";

export function sourceKey(source: string): SourceKey {
  const s = (source || "").toLowerCase();
  if (s.includes("youtube") || s.includes("youtu.be")) return "youtube";
  if (s.includes("twitch")) return "twitch";
  if (s.includes("twitter") || s === "x" || s.includes("x.com")) return "x";
  return "other";
}

export function sourceLabel(source: string): string {
  const key = sourceKey(source);
  if (key === "youtube") return "YouTube";
  if (key === "twitch") return "Twitch";
  if (key === "x") return "X";
  const s = (source || "").trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Web";
}

interface Props {
  source: string;
  size?: number;
}

export default function SourceIcon({ source, size = 16 }: Props) {
  const key = sourceKey(source);
  if (key === "other") {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="source-generic" aria-hidden="true">
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path d="M2 8h12M8 2c2.2 2.2 2.2 9.8 0 12M8 2c-2.2 2.2-2.2 9.8 0 12" stroke="currentColor" strokeWidth="1.1" />
      </svg>
    );
  }
  return <img src={icons[key]} alt="" width={size} height={size} className={`source-icon ${key}`} />;
}
