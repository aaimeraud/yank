-- The first schema defaulted queue_items.status to 'pending', which no code
-- writes and the app does not know. One such row would make the whole
-- Downloads list fail to load, so park any unknown status as paused, where
-- the user can resume or remove it.
UPDATE queue_items SET status = 'paused'
WHERE status NOT IN ('queued', 'downloading', 'paused', 'done', 'failed', 'cancelled');
