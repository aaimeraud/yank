-- Where a video sits in its playlist. The library keeps the real title and
-- derives the displayed number from this column, so re-adding a reordered
-- playlist can renumber videos without rewriting titles.
ALTER TABLE videos ADD COLUMN playlist_index INTEGER;

CREATE INDEX IF NOT EXISTS idx_videos_playlist_order ON videos(playlist_id, playlist_index);
