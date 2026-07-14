/**
 * PostgreSQL Database Initialization
 *
 * Handles database connection and table initialization for PostgreSQL storage.
 * This module ensures that the required tables and extensions exist before
 * the adapter can be used.
 */

import type { PostgresStorageConfig } from '../storage-types';

/**
 * Current memory schema version. Bump when ensureTablesExist DDL changes so
 * booted processes re-run the (idempotent) DDL exactly once per version.
 */
export const MEMORY_SCHEMA_VERSION = 3;

/**
 * Initializes the PostgreSQL connection pool
 *
 * Uses a Pool (not a single Client) so concurrent queries in one process do
 * not serialize on one connection, and dropped connections are replaced
 * automatically instead of killing the memory layer for the process.
 *
 * @param config - PostgreSQL storage configuration
 * @returns PostgreSQL pool instance (query-compatible with the old Client)
 * @throws Error if the initial connection fails
 */
export async function initDatabase(config: PostgresStorageConfig): Promise<any> {
  // Dynamic import to avoid requiring pg as a dependency if not using PostgreSQL
  const { Pool } = await import('pg');
  const pgvector = await import('pgvector/pg');

  const pool = new Pool({
    connectionString: config.connectionString,
  });

  // Fail fast on unreachable database and register pgvector result parsers.
  // client.setTypeParser writes to pg's global, OID-keyed type registry, so a
  // single registration covers every connection in the pool (same semantics
  // as the previous single-Client setup).
  const client = await pool.connect();
  try {
    await pgvector.registerType(client);
  } finally {
    client.release();
  }

  return pool;
}

/**
 * Ensures required tables and extensions exist
 *
 * @param client - PostgreSQL client instance
 * @param schema - Schema name (default: 'memory' - recommended to separate from Application Layer)
 * @throws Error if initialization fails
 */
/**
 * Advisory lock key serializing memory DDL across processes.
 * Concurrent cold starts running ensureTablesExist simultaneously can hit
 * Postgres catalog conflicts ("tuple concurrently updated"); the lock makes
 * one process run DDL while others wait, then no-op on IF NOT EXISTS.
 */
const MEMORY_DDL_LOCK_KEY = 810529641;

/**
 * Reads the stored schema version, or null when not initialized yet.
 */
async function readSchemaVersion(client: any, schema: string): Promise<number | null> {
  const reg = await client.query('SELECT to_regclass($1) AS t', [`${schema}.schema_version`]);
  if (!reg.rows[0]?.t) return null;
  const res = await client.query(`SELECT version FROM ${schema}.schema_version LIMIT 1`);
  return res.rows[0] ? Number(res.rows[0].version) : null;
}

/**
 * Ensures required tables, indexes and functions exist.
 *
 * Version-gated: when the stored schema version equals MEMORY_SCHEMA_VERSION
 * the DDL is skipped entirely (fast cold starts, no catalog writes). The
 * whole check-and-migrate runs on ONE dedicated connection under an advisory
 * lock — session-scoped locks would break if spread across pool connections.
 *
 * @param pool - PostgreSQL pool instance (from initDatabase)
 * @param schema - Schema name (default: 'memory')
 * @throws Error if initialization fails
 */
export async function ensureTablesExist(pool: any, schema: string = 'memory'): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MEMORY_DDL_LOCK_KEY]);
    try {
      const current = await readSchemaVersion(client, schema);
      if (current === MEMORY_SCHEMA_VERSION) {
        return; // schema up to date — skip all DDL
      }
      await ensureTablesExistInner(client, schema);
      await client.query(
        `INSERT INTO ${schema}.schema_version (singleton, version, updated_at)
         VALUES (TRUE, $1, NOW())
         ON CONFLICT (singleton) DO UPDATE SET version = EXCLUDED.version, updated_at = NOW()`,
        [MEMORY_SCHEMA_VERSION],
      );
      console.log(
        `[Memory] schema migrated: v${current ?? 'none'} -> v${MEMORY_SCHEMA_VERSION}`,
      );
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MEMORY_DDL_LOCK_KEY]);
    }
  } finally {
    client.release();
  }
}

async function ensureTablesExistInner(client: any, schema: string): Promise<void> {
  // Enable pgvector extension
  await client.query('CREATE EXTENSION IF NOT EXISTS vector');

  // Create schema if it doesn't exist
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);

  // Create memories table
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.memories (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding VECTOR(1536),
      outgoing_edges UUID[] DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Create indexes
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_memories_entity_id 
    ON ${schema}.memories(entity_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_memories_embedding 
    ON ${schema}.memories 
    USING ivfflat (embedding vector_cosine_ops)
    WITH (lists = 100)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_memories_outgoing_edges 
    ON ${schema}.memories 
    USING gin (outgoing_edges)
  `);

  // Create vector similarity search function
  await client.query(`
    CREATE OR REPLACE FUNCTION ${schema}.match_memories(
      query_embedding VECTOR(1536),
      entity_id_filter TEXT,
      match_threshold FLOAT DEFAULT 0.7,
      match_count INT DEFAULT 10
    )
    RETURNS TABLE (
      id UUID,
      entity_id TEXT,
      content TEXT,
      embedding VECTOR(1536),
      outgoing_edges UUID[],
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      similarity FLOAT
    )
    LANGUAGE plpgsql
    AS $$
    BEGIN
      RETURN QUERY
      SELECT
        m.id,
        m.entity_id,
        m.content,
        m.embedding,
        m.outgoing_edges,
        m.created_at,
        m.updated_at,
        1 - (m.embedding <=> query_embedding) AS similarity
      FROM ${schema}.memories m
      WHERE m.entity_id = entity_id_filter
        AND m.embedding IS NOT NULL
        AND 1 - (m.embedding <=> query_embedding) >= match_threshold
      ORDER BY m.embedding <=> query_embedding
      LIMIT match_count;
    END;
    $$;
  `);

  // Create graph traversal function using recursive CTE
  // This function handles a single starting memory
  await client.query(`
    CREATE OR REPLACE FUNCTION ${schema}.get_connected_memories(
      start_memory_id UUID,
      max_depth INT DEFAULT 1
    )
    RETURNS TABLE (
      id UUID,
      entity_id TEXT,
      content TEXT,
      embedding VECTOR(1536),
      outgoing_edges UUID[],
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      depth INT
    )
    LANGUAGE sql
    STABLE
    AS $$
      WITH RECURSIVE memory_tree AS (
        -- Base case: starting memory (depth 0, but we exclude it from results)
        SELECT
          m.id,
          m.entity_id,
          m.content,
          m.embedding,
          m.outgoing_edges,
          m.created_at,
          m.updated_at,
          0 AS depth,
          ARRAY[m.id] AS visited_path
        FROM ${schema}.memories m
        WHERE m.id = start_memory_id

        UNION ALL

        -- Recursive case: follow outgoing_edges
        SELECT
          m.id,
          m.entity_id,
          m.content,
          m.embedding,
          m.outgoing_edges,
          m.created_at,
          m.updated_at,
          mt.depth + 1 AS depth,
          mt.visited_path || m.id AS visited_path
        FROM ${schema}.memories m
        INNER JOIN memory_tree mt ON m.id = ANY(mt.outgoing_edges)
        WHERE mt.depth < max_depth
          AND NOT (m.id = ANY(mt.visited_path))
      )
      SELECT DISTINCT ON (mt.id)
        mt.id,
        mt.entity_id,
        mt.content,
        mt.embedding,
        mt.outgoing_edges,
        mt.created_at,
        mt.updated_at,
        mt.depth
      FROM memory_tree mt
      WHERE mt.depth > 0
      ORDER BY mt.id, mt.depth ASC;
    $$;
  `);

  // Create dedup gate decisions table (audit + threshold calibration)
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.gate_decisions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      decision TEXT NOT NULL,
      similarity REAL,
      matched_memory_id UUID,
      new_memory_id UUID,
      candidate_content TEXT NOT NULL,
      threshold REAL NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_gate_decisions_entity_id
    ON ${schema}.gate_decisions(entity_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_gate_decisions_created_at
    ON ${schema}.gate_decisions(created_at)
  `);

  // Create edge traversals table for tracking graph traversal statistics
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.edge_traversals (
      entity_id TEXT NOT NULL,
      from_memory_id UUID NOT NULL,
      to_memory_id UUID NOT NULL,
      traversal_count INTEGER NOT NULL DEFAULT 1,
      last_traversed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (entity_id, from_memory_id, to_memory_id)
    )
  `);

  // Create index for querying edge traversals by entity
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_edge_traversals_entity_id
    ON ${schema}.edge_traversals(entity_id)
  `);

  // Create function to get connected memories from multiple starting points without duplicates
  await client.query(`
    CREATE OR REPLACE FUNCTION ${schema}.get_connected_memories_from_multiple(
      start_memory_ids UUID[],
      max_depth INT DEFAULT 1
    )
    RETURNS TABLE (
      id UUID,
      entity_id TEXT,
      content TEXT,
      embedding VECTOR(1536),
      outgoing_edges UUID[],
      created_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ,
      depth INT
    )
    LANGUAGE sql
    STABLE
    AS $$
      WITH RECURSIVE memory_tree AS (
        -- Base case: all starting memories (depth 0, but we exclude them from results)
        SELECT
          m.id,
          m.entity_id,
          m.content,
          m.embedding,
          m.outgoing_edges,
          m.created_at,
          m.updated_at,
          0 AS depth,
          ARRAY[m.id] AS visited_path
        FROM ${schema}.memories m
        WHERE m.id = ANY(start_memory_ids)

        UNION ALL

        -- Recursive case: follow outgoing_edges
        SELECT
          m.id,
          m.entity_id,
          m.content,
          m.embedding,
          m.outgoing_edges,
          m.created_at,
          m.updated_at,
          mt.depth + 1 AS depth,
          mt.visited_path || m.id AS visited_path
        FROM ${schema}.memories m
        INNER JOIN memory_tree mt ON m.id = ANY(mt.outgoing_edges)
        WHERE mt.depth < max_depth
          AND NOT (m.id = ANY(mt.visited_path))
      )
      SELECT DISTINCT ON (mt.id)
        mt.id,
        mt.entity_id,
        mt.content,
        mt.embedding,
        mt.outgoing_edges,
        mt.created_at,
        mt.updated_at,
        mt.depth
      FROM memory_tree mt
      WHERE mt.depth > 0
        AND NOT (mt.id = ANY(start_memory_ids))
      ORDER BY mt.id, mt.depth ASC;
    $$;
  `);

  // --- v2: usage-carved memory foundation ---------------------------------
  // Node dynamic state (strength/decay anchors, retrieval stats, status).
  // Additive with defaults: existing rows/readers are unaffected.
  await client.query(`
    ALTER TABLE ${schema}.memories
      ADD COLUMN IF NOT EXISTS strength REAL NOT NULL DEFAULT 0.5,
      ADD COLUMN IF NOT EXISTS strength_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS retrieval_count INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS last_retrieved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
  `);

  // First-class edges. Edges are hypotheses: created cheap, strengthened by
  // usage, decayed by disuse. Nothing reads this table until the ranked
  // retrieval path ships; until then it is write-only.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.edges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id TEXT NOT NULL,
      from_id UUID NOT NULL REFERENCES ${schema}.memories(id) ON DELETE CASCADE,
      to_id UUID NOT NULL REFERENCES ${schema}.memories(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'related',
      origin TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 0.5,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      strength_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (from_id, to_id, type)
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_edges_entity_id
    ON ${schema}.edges(entity_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_edges_from_id
    ON ${schema}.edges(from_id)
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_edges_to_id
    ON ${schema}.edges(to_id)
  `);

  // Sleep worker job queue. Verdict columns live on the job row so the queue
  // doubles as the audit log (no separate audit table).
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.sleep_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      verdict JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_sleep_jobs_entity_status
    ON ${schema}.sleep_jobs(entity_id, status)
  `);

  // --- v3: retrieval shadow comparison log --------------------------------
  // One row per shadowed retrieval: legacy vs ranked result diff. Used to
  // calibrate ranking weights before switching the live path. Transient —
  // dropped once calibration is done.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.retrieval_shadow_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_id TEXT NOT NULL,
      query TEXT NOT NULL,
      legacy_ids UUID[] NOT NULL,
      ranked_ids UUID[] NOT NULL,
      overlap INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_retrieval_shadow_log_created_at
    ON ${schema}.retrieval_shadow_log(created_at)
  `);

  // Single-row schema version for the boot DDL gate.
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${schema}.schema_version (
      singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
      version INTEGER NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
