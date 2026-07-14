-- 0002_rollback.sql — hard rollback of 0002_foundation.sql
--
-- ORDER MATTERS: roll back the application code FIRST (old code never
-- references these objects, so it runs fine while they still exist).
-- Only run this file when you also want the schema gone; leaving the
-- objects in place is harmless and preserves accumulated edge strength
-- for a later roll-forward (soft rollback = code revert only).
--
-- Destroys: all rows in memory.edges / memory.sleep_jobs, the added
-- node columns (and their values), and the version gate row.

DROP TABLE IF EXISTS memory.sleep_jobs;
DROP TABLE IF EXISTS memory.edges;
DROP TABLE IF EXISTS memory.schema_version;

ALTER TABLE memory.memories
  DROP COLUMN IF EXISTS strength,
  DROP COLUMN IF EXISTS strength_updated_at,
  DROP COLUMN IF EXISTS retrieval_count,
  DROP COLUMN IF EXISTS last_retrieved_at,
  DROP COLUMN IF EXISTS status;
