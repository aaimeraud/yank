CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlists (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    source TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    thumbnail_path TEXT
);

CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    uploader TEXT,
    duration INTEGER,
    thumbnail_path TEXT,
    source TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    file_path TEXT,
    file_size INTEGER,
    downloaded_at INTEGER,
    last_position INTEGER NOT NULL DEFAULT 0,
    watched INTEGER NOT NULL DEFAULT 0,
    playlist_id TEXT REFERENCES playlists(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS queue_items (
    id TEXT PRIMARY KEY,
    video_id TEXT REFERENCES videos(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    progress REAL NOT NULL DEFAULT 0,
    speed TEXT,
    eta TEXT,
    error TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_videos_playlist ON videos(playlist_id);
CREATE INDEX IF NOT EXISTS idx_queue_status ON queue_items(status);
