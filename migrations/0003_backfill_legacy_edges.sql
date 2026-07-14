-- 0003_backfill_legacy_edges.sql
--
-- Backfill: migrate every legacy outgoing_edges array entry into the
-- first-class memory.edges table.
--
-- - Fixed strength (0.5) + origin='legacy': bulk migrations get rule-based
--   values; usage (bump) and the sleep worker carve precise weights later.
-- - Idempotent: ON CONFLICT DO NOTHING — safe to re-run.
-- - Source arrays are NOT modified.
-- - Self-loops and dangling references (targets that no longer exist) are
--   skipped; deleting a memory later cascades to its edges via FK.
-- - Run EXPLICITLY (not part of boot DDL). Deadline: before the ranked
--   retrieval path starts reading edges.
--
-- Rollback (backfill only):
--   DELETE FROM memory.edges WHERE origin = 'legacy';

INSERT INTO memory.edges (entity_id, from_id, to_id, type, origin, strength)
SELECT m.entity_id, m.id, t.to_id, 'related', 'legacy', 0.5
FROM memory.memories m
CROSS JOIN LATERAL unnest(m.outgoing_edges) AS t(to_id)
JOIN memory.memories tm ON tm.id = t.to_id
WHERE m.id <> t.to_id
ON CONFLICT (from_id, to_id, type) DO NOTHING;
