-- The format a download was queued with. Resume and retry reuse it, so
-- changing the default in Settings never silently turns a queued video into
-- an audio file. NULL on rows created before this column: they fall back to
-- the current default.
ALTER TABLE queue_items ADD COLUMN format TEXT;
