// The download formats offered in the UI. Values match `Format` in
// src-tauri/src/models.rs; see ADR 0002 for why "video" means H.264 MP4.

import type { Format } from "../types";

export const FORMAT_OPTIONS: { value: Format; label: string; short: string }[] = [
  { value: "video", label: "Video · MP4 (H.264)", short: "Video (MP4)" },
  { value: "audio", label: "Audio only · M4A", short: "Audio only" },
  { value: "original", label: "Original · best available", short: "Best quality" },
];
