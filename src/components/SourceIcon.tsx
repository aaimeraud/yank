import youtubeIcon from "../assets/youtube.svg";
import twitchIcon from "../assets/twitch.svg";
import xIcon from "../assets/X (formerly Twitter)_light_dark/X (formerly Twitter)_dark.svg";
import { sourceKey, sourceLabel, type SourceKey } from "../lib/source";

const ICONS: Record<Exclude<SourceKey, "other">, string> = {
  youtube: youtubeIcon,
  twitch: twitchIcon,
  twitter: xIcon,
};

interface Props {
  /** A yt-dlp extractor name, or a SourceKey. */
  source: string;
  size?: number;
  /** Announce the platform to screen readers; off when a label is next to it. */
  labelled?: boolean;
}

/** The platform's logo, or a globe for every other site. */
export default function SourceIcon({ source, size = 16, labelled = false }: Props) {
  const key = sourceKey(source);
  const alt = labelled ? sourceLabel(source) : "";
  if (key === "other") {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        className="source-generic"
        role={labelled ? "img" : undefined}
        aria-label={labelled ? alt : undefined}
        aria-hidden={labelled ? undefined : true}
      >
        <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
        <path
          d="M2 8h12M8 2c2.2 2.2 2.2 9.8 0 12M8 2c-2.2 2.2-2.2 9.8 0 12"
          stroke="currentColor"
          strokeWidth="1.1"
        />
      </svg>
    );
  }
  return <img src={ICONS[key]} alt={alt} width={size} height={size} className={`source-icon ${key}`} />;
}
