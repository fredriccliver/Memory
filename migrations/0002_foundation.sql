-- 0002_foundation.sql
--
-- Usage-carved memory foundation: first-class edges, node dynamic state,
-- sleep worker job queue, and the boot-DDL version gate.
--
-- Mirrors the runtime DDL in src/storage/migrations/postgres-init.ts
-- (ensureTablesExist, MEMORY_SCHEMA_VERSION = 2). Idempotent.
-- Purely additive: existing tables, columns and readers are unaffected.
-- Rollback: 0002_rollback.sql (roll back the CODE first — see its header).
--
-- Schema note: replace `memory` with your configured schema if different.

-- Node dynamic state (strength/decay anchors, retrieval stats, status)
ALTER TABLE memory.memories
  ADD COLUMN IF NOT EXISTS strength REAL NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS strength_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS retrieval_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- First-class edges (hypotheses: cheap to create, usage strengthens,
-- disuse decays; effective strength is computed lazily at read time)
CREATE TABLE IF NOT EXISTS memory.edges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id TEXT NOT NULL,
  from_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
  to_id UUID NOT NULL REFERENCES memory.memories(id) ON DELETE CASCADE,
  -- 'related' (undirected meaning) | 'summary_of' | 'supersedes' | extensible
  type TEXT NOT NULL DEFAULT 'related',
  -- 'conversation' | 'knn_seed' | 'sleep' | 'import' | 'legacy'
  origin TEXT NOT NULL,
  strength REAL NOT NULL DEFAULT 0.5,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  strength_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (from_id, to_id, type)
);

CREATE INDEX IF NOT EXISTS idx_edges_entity_id ON memory.edges(entity_id);
CREATE INDEX IF NOT EXISTS idx_edges_from_id ON memory.edges(from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_id ON memory.edges(to_id);

-- Sleep worker job queue; verdict lives on the row so the queue doubles
-- as the audit log
CREATE TABLE IF NOT EXISTS memory.sleep_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id TEXT NOT NULL,
  -- 'merge_review' | extensible
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  -- 'pending' | 'done' | 'failed' | 'skipped'
  status TEXT NOT NULL DEFAULT 'pending',
  verdict JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sleep_jobs_entity_status
  ON memory.sleep_jobs(entity_id, status);

-- Single-row schema version for the boot DDL gate
CREATE TABLE IF NOT EXISTS memory.schema_version (
  singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  version INTEGER NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO memory.schema_version (singleton, version, updated_at)
VALUES (TRUE, 2, NOW())
ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version, updated_at = NOW();
