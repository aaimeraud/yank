import { useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { Video } from "../types";
import SourceIcon from "./SourceIcon";

/** A video's thumbnail, or its source icon when there is none or it is gone. */
export default function ThumbImage({ video, size }: { video: Video; size: number }) {
  const [broken, setBroken] = useState<string | null>(null);
  const path = video.thumbnail_path;
  // Keyed on the path, so a list row reused for another video retries.
  if (!path || broken === path) return <SourceIcon source={video.source} size={size} />;
  return <img src={convertFileSrc(path)} alt="" loading="lazy" onError={() => setBroken(path)} />;
}
