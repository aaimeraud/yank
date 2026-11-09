// The download formats offered in the UI. Values match `Format` in
// src-tauri/src/models.rs; see ADR 0002 for why "video" means H.264 MP4.

import type { Format } from "../types";

export const FORMAT_OPTIONS: { value: Format; label: string; short: string }[] = [
  { value: "video", label: "Video · MP4 (H.264)", short: "Video (MP4)" },
  { value: "audio", label: "Audio only · M4A", short: "Audio only" },
  { value: "original", label: "Original · best available", short: "Best quality" },
];

/** The select entry that opens the quality picker instead of naming a format. */
export const CHOOSE_QUALITY = "choose";

/** What a finished download's row says about its format; empty for the default. */
export function formatTag(format: string | null): string {
  if (format === "audio") return "Audio";
  return format && /^\d+p$/.test(format) ? format : "";
}

/**
 * The URL box's format: what it sends and what its select shows. It sends
 * only an explicit pick; null lets the backend apply the Settings default
 * (ADR 0006), which is right even before the UI has loaded the settings.
 * Until then the select shows a placeholder ("") instead of guessing.
 */
export function urlBoxFormat(picked: Format | null, settingsDefault: Format | null) {
  return { send: picked, shown: picked ?? settingsDefault ?? "" };
}
