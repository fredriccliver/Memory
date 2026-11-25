-- Explicit work attribution and idempotency for work-scoped graph updates.
CREATE TABLE IF NOT EXISTS memory.work_usage (
  entity_id text NOT NULL,
  actor_id text NOT NULL,
  work_id text NOT NULL,
  uses jsonb NOT NULL CHECK (jsonb_typeof(uses) = 'array'),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (entity_id, actor_id, work_id)
);
ALTER TABLE memory.work_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON memory.work_usage FROM public;

INSERT INTO memory.schema_version (singleton, version, updated_at)
VALUES (TRUE, 4, NOW())
ON CONFLICT (singleton) DO UPDATE SET version = GREATEST(memory.schema_version.version, 4), updated_at = NOW();
