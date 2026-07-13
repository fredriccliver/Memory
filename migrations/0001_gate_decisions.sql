-- 0001_gate_decisions.sql
--
-- Dedup gate decision log: one row per creation attempt evaluated by the
-- dedup gate (shadow or active mode). Used for audit and threshold calibration.
--
-- This file mirrors the runtime DDL in src/storage/migrations/postgres-init.ts
-- (ensureTablesExist). Both are idempotent; apply this file manually when you
-- prefer explicit migrations over boot-time DDL.
--
-- Schema note: replace `memory` with your configured schema if different.

CREATE SCHEMA IF NOT EXISTS memory;

CREATE TABLE IF NOT EXISTS memory.gate_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id TEXT NOT NULL,
  -- Gate mode in effect at decision time: 'shadow' | 'active'
  mode TEXT NOT NULL,
  -- 'created' | 'would_skip' (shadow: duplicate detected, created anyway) | 'skipped' (active: creation skipped)
  decision TEXT NOT NULL,
  -- Similarity to the nearest existing memory (NULL when the entity had no comparable memory)
  similarity REAL,
  matched_memory_id UUID,
  -- Created memory id (NULL when creation was skipped)
  new_memory_id UUID,
  -- Candidate content, kept for audit of skipped creations
  candidate_content TEXT NOT NULL,
  -- Dedup skip threshold in effect at decision time
  threshold REAL NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gate_decisions_entity_id
  ON memory.gate_decisions(entity_id);

CREATE INDEX IF NOT EXISTS idx_gate_decisions_created_at
  ON memory.gate_decisions(created_at);
