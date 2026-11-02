export type View = "library" | "downloads" | "settings";

export interface Video {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail_path: string | null;
  source: string;
  url: string;
  file_path: string | null;
  watched: boolean;
  last_position: number;
  folder_id: string | null;
  playlist_id?: string | null;
  /** 1-based position in the playlist, or null for a standalone video. */
  playlist_index?: number | null;
}

export interface Folder {
  id: string;
  name: string;
  created_at: number;
  video_count: number;
}

export interface QueueItem {
  id: string;
  video_id: string | null;
  status: string;
  progress: number;
  speed: string | null;
  eta: string | null;
  error: string | null;
  created_at: number;
}

export interface Metadata {
  id: string;
  title: string;
  uploader: string | null;
  duration: number | null;
  thumbnail: string | null;
  extractor: string | null;
  webpage_url: string | null;
  /** 1-based position in the playlist, or 1 for a single video. */
  index: number;
  /** Number of entries in the playlist, or 1 for a single video. */
  total: number;
}

export interface Playlist {
  id: string;
  title: string;
  source: string;
  url: string;
  thumbnail_path: string | null;
}

export interface PlaylistInfo {
  title: string;
  is_playlist: boolean;
  entries: Metadata[];
}