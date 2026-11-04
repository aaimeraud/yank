// Mapping yt-dlp extractor names to the platforms the UI knows.
//
// The backend stores the extractor as yt-dlp reports it ("youtube",
// "youtube:tab", "twitter", "twitch:vod", "TwitchClips", "generic"...).
// Everything that is not one of the three main platforms is "other".

export type SourceKey = "youtube" | "twitter" | "twitch" | "other";

export const SOURCE_KEYS: SourceKey[] = ["youtube", "twitter", "twitch", "other"];

export function sourceKey(source: string | null | undefined): SourceKey {
  const s = (source ?? "").toLowerCase();
  if (s.includes("youtube") || s.includes("youtu.be")) return "youtube";
  if (s.includes("twitch")) return "twitch";
  if (s.includes("twitter") || s === "x" || s.includes("x.com")) return "twitter";
  return "other";
}

const LABELS: Record<Exclude<SourceKey, "other">, string> = {
  youtube: "YouTube",
  twitter: "X",
  twitch: "Twitch",
};

/** The brand for the main platforms, the extractor's own name otherwise. */
export function sourceLabel(source: string | null | undefined): string {
  const key = sourceKey(source);
  if (key !== "other") return LABELS[key];
  const raw = (source ?? "").split(":")[0].trim();
  if (!raw || raw.toLowerCase() === "generic") return "Web";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/** Label for a filter chip. */
export function sourceKeyLabel(key: SourceKey): string {
  return key === "other" ? "Other" : LABELS[key];
}
