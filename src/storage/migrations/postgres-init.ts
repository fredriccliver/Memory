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
}
