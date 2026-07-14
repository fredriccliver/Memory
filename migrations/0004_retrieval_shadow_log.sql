-- 0004_retrieval_shadow_log.sql
--
-- Retrieval shadow comparison log: one row per shadowed retrieval with the
-- legacy vs ranked result diff. Used to calibrate ranking weights before
-- switching the live retrieval path. Transient — safe to drop once ranked
-- calibration is done.
--
-- Mirrors the runtime DDL in src/storage/migrations/postgres-init.ts
-- (ensureTablesExist, MEMORY_SCHEMA_VERSION = 3). Idempotent.
--
-- Rollback:
--   DROP TABLE IF EXISTS memory.retrieval_shadow_log;

CREATE TABLE IF NOT EXISTS memory.retrieval_shadow_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id TEXT NOT NULL,
  query TEXT NOT NULL,
  legacy_ids UUID[] NOT NULL,
  ranked_ids UUID[] NOT NULL,
  overlap INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_retrieval_shadow_log_created_at
  ON memory.retrieval_shadow_log(created_at);

INSERT INTO memory.schema_version (singleton, version, updated_at)
VALUES (TRUE, 3, NOW())
ON CONFLICT (singleton) DO UPDATE SET version = GREATEST(memory.schema_version.version, 3), updated_at = NOW();
