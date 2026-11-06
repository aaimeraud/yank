// Turning a stored path into something an <img> or <video> can load.

import { convertFileSrc } from "@tauri-apps/api/core";

/**
 * Library thumbnails are files on disk and go through Tauri's asset
 * protocol; YouTube search hits carry web URLs (i.ytimg.com), which load
 * as they are. Converting a web URL would produce an asset:// link to a
 * file that does not exist.
 */
export function mediaSrc(path: string): string {
  return isWebUrl(path) ? path : convertFileSrc(path);
}

export function isWebUrl(path: string): boolean {
  return /^https?:\/\//i.test(path);
}
