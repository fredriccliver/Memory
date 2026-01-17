/**
 * PostgreSQL Database Initialization
 *
 * Handles database connection and table initialization for PostgreSQL storage.
 * This module ensures that the required tables and extensions exist before
 * the adapter can be used.
 */

import type { PostgresStorageConfig } from '../storage-types';

/**
 * Initializes PostgreSQL database connection
 *
 * @param config - PostgreSQL storage configuration
 * @returns PostgreSQL client instance
 * @throws Error if connection fails
 */
export async function initDatabase(config: PostgresStorageConfig): Promise<any> {
  // Dynamic import to avoid requiring pg as a dependency if not using PostgreSQL
  const { Client } = await import('pg');
  const pgvector = await import('pgvector/pg');

  const client = new Client({
    connectionString: config.connectionString,
  });

  await client.connect();

  // Register pgvector types
  await pgvector.registerType(client);

  return client;
}

/**
 * Ensures required tables and extensions exist
 *
 * @param client - PostgreSQL client instance
 * @param schema - Schema name (default: 'memory' - recommended to separate from Application Layer)
 * @throws Error if initialization fails
 */
export async function ensureTablesExist(client: any, schema: string = 'memory'): Promise<void> {
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
}
