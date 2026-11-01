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