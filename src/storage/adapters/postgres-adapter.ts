/**
 * PostgreSQL Storage Adapter
 *
 * Implements MemoryStorageAdapter using PostgreSQL with pgvector extension.
 * This adapter handles all memory operations including vector search and graph traversal.
 */

import type { MemoryStorageAdapter } from '../../adapters/database-adapter';
import type { Memory, EdgeTraversalStat, GateDecisionRecord } from '../../types';
import type { PostgresStorageConfig } from '../storage-types';
import { initDatabase, ensureTablesExist } from '../migrations/postgres-init';

/**
 * PostgreSQL adapter for memory storage
 *
 * @public
 */
export class PostgresAdapter implements MemoryStorageAdapter {
  private config: PostgresStorageConfig;
  private client: any; // Will be typed as pg.Client after installing @types/pg

  /**
   * Creates a new PostgreSQL adapter
   *
   * @param config - PostgreSQL storage configuration
   */
  constructor(config: PostgresStorageConfig) {
    this.config = config;
  }

  /**
   * Initializes the database connection and ensures tables exist
   *
   * @throws Error if connection or initialization fails
   */
  async initialize(): Promise<void> {
    this.client = await initDatabase(this.config);
    await ensureTablesExist(this.client, this.config.schema || 'memory');
  }

  /**
   * Closes the database connection
   */
  async close(): Promise<void> {
    if (this.client) {
      await this.client.end();
    }
  }

  async createMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory> {
    const schema = this.config.schema || 'memory';
    const query = `
      INSERT INTO ${schema}.memories (
        entity_id,
        content,
        embedding,
        outgoing_edges,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW(), NOW())
      RETURNING id, created_at, updated_at
    `;

    // Convert embedding array to pgvector format
    let embeddingValue = null;
    if (memory.embedding && Array.isArray(memory.embedding)) {
      const pgvector = await import('pgvector/pg');
      embeddingValue = pgvector.toSql(memory.embedding);
    }

    const result = await this.client.query(query, [
      memory.entityId,
      memory.content,
      embeddingValue,
      memory.outgoingEdges || [],
    ]);

    return {
      ...memory,
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at,
      updatedAt: result.rows[0].updated_at,
    };
  }

  async getMemory(memoryId: string): Promise<Memory | null> {
    const schema = this.config.schema || 'memory';
    const query = `
      SELECT * FROM ${schema}.memories
      WHERE id = $1
    `;

    const result = await this.client.query(query, [memoryId]);

    if (result.rows.length === 0) {
      return null;
    }

    return this.mapRowToMemory(result.rows[0]);
  }

  async updateMemory(
    memoryId: string,
    updates: Partial<Omit<Memory, 'id' | 'createdAt'>>,
  ): Promise<Memory> {
    const schema = this.config.schema || 'memory';
    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (updates.content !== undefined) {
      setClauses.push(`content = $${paramIndex++}`);
      values.push(updates.content);
    }

    if (updates.embedding !== undefined) {
      setClauses.push(`embedding = $${paramIndex++}`);
      // Convert embedding array to pgvector format
      if (Array.isArray(updates.embedding)) {
        const pgvector = await import('pgvector/pg');
        values.push(pgvector.toSql(updates.embedding));
      } else {
        values.push(updates.embedding);
      }
    }

    if (updates.outgoingEdges !== undefined) {
      setClauses.push(`outgoing_edges = $${paramIndex++}`);
      values.push(updates.outgoingEdges);
    }

    setClauses.push(`updated_at = NOW()`);
    values.push(memoryId);

    const query = `
      UPDATE ${schema}.memories
      SET ${setClauses.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await this.client.query(query, values);

    if (result.rows.length === 0) {
      throw new Error(`Memory not found: ${memoryId}`);
    }

    return this.mapRowToMemory(result.rows[0]);
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    const schema = this.config.schema || 'memory';
    const query = `
      DELETE FROM ${schema}.memories
      WHERE id = $1
    `;

    const result = await this.client.query(query, [memoryId]);
    return result.rowCount > 0;
  }

  async getMemoriesByEntity(entityId: string): Promise<Memory[]> {
    const schema = this.config.schema || 'memory';
    const query = `
      SELECT * FROM ${schema}.memories
      WHERE entity_id = $1
      ORDER BY created_at DESC
    `;

    const result = await this.client.query(query, [entityId]);
    return result.rows.map((row: any) => this.mapRowToMemory(row));
  }

  async searchByVector(
    embedding: number[],
    entityId: string,
    limit: number = 10,
    threshold: number = 0.7,
  ): Promise<Memory[]> {
    const schema = this.config.schema || 'memory';
    const query = `
      SELECT *, 1 - (embedding <=> $1::vector) as similarity
      FROM ${schema}.memories
      WHERE entity_id = $2
        AND embedding IS NOT NULL
        AND 1 - (embedding <=> $1::vector) >= $3
      ORDER BY embedding <=> $1::vector
      LIMIT $4
    `;

    // Convert embedding array to pgvector format
    const pgvector = await import('pgvector/pg');
    const embeddingValue = pgvector.toSql(embedding);

    const result = await this.client.query(query, [embeddingValue, entityId, threshold, limit]);

    return result.rows.map((row: any) => this.mapRowToMemory(row));
  }

  async getConnectedMemories(memoryId: string, depth: number = 1): Promise<Memory[]> {
    const schema = this.config.schema || 'memory';
    const query = `
      SELECT * FROM ${schema}.get_connected_memories($1, $2)
    `;

    const result = await this.client.query(query, [memoryId, depth]);
    return result.rows.map((row: any) => this.mapRowToMemory(row));
  }

  async getConnectedMemoriesFromMultiple(
    memoryIds: string[],
    depth: number = 1,
  ): Promise<Memory[]> {
    if (memoryIds.length === 0) {
      return [];
    }

    const schema = this.config.schema || 'memory';
    const query = `
      SELECT * FROM ${schema}.get_connected_memories_from_multiple($1, $2)
    `;

    const result = await this.client.query(query, [memoryIds, depth]);
    return result.rows.map((row: any) => this.mapRowToMemory(row));
  }

  async updateOutgoingEdges(memoryId: string, outgoingEdges: string[]): Promise<Memory> {
    return this.updateMemory(memoryId, { outgoingEdges });
  }

  async updateEmbedding(memoryId: string, embedding: number[]): Promise<Memory> {
    return this.updateMemory(memoryId, { embedding });
  }

  async getAllEntityIds(): Promise<string[]> {
    const schema = this.config.schema || 'memory';
    const query = `
      SELECT DISTINCT entity_id FROM ${schema}.memories
      ORDER BY entity_id
    `;

    const result = await this.client.query(query);
    return result.rows.map((row: any) => row.entity_id);
  }

  /**
   * Record edge traversals for statistics tracking
   *
   * @description Uses INSERT ... ON CONFLICT DO UPDATE to upsert traversal counts.
   *
   * @param entityId - Entity ID the edges belong to
   * @param edges - Array of traversed edges (from → to)
   */
  async recordEdgeTraversals(
    entityId: string,
    edges: Array<{ from: string; to: string }>,
  ): Promise<void> {
    if (edges.length === 0) return;

    const schema = this.config.schema || 'memory';

    // Build batch VALUES clause
    const values: any[] = [];
    const valuePlaceholders: string[] = [];
    let paramIndex = 1;

    for (const edge of edges) {
      valuePlaceholders.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++})`);
      values.push(entityId, edge.from, edge.to);
    }

    const query = `
      INSERT INTO ${schema}.edge_traversals (entity_id, from_memory_id, to_memory_id)
      VALUES ${valuePlaceholders.join(', ')}
      ON CONFLICT (entity_id, from_memory_id, to_memory_id)
      DO UPDATE SET
        traversal_count = ${schema}.edge_traversals.traversal_count + 1,
        last_traversed_at = NOW()
    `;

    await this.client.query(query, values);
  }

  /**
   * Get edge traversal statistics for an entity
   *
   * @description Returns all recorded edge traversals sorted by traversal_count DESC.
   *
   * @param entityId - Entity ID to query
   * @returns Array of edge traversal statistics
   */
  async getEdgeTraversalStats(entityId: string): Promise<EdgeTraversalStat[]> {
    const schema = this.config.schema || 'memory';
    const query = `
      SELECT from_memory_id, to_memory_id, traversal_count, last_traversed_at
      FROM ${schema}.edge_traversals
      WHERE entity_id = $1
      ORDER BY traversal_count DESC
    `;

    const result = await this.client.query(query, [entityId]);

    return result.rows.map((row: any) => ({
      fromMemoryId: row.from_memory_id,
      toMemoryId: row.to_memory_id,
      traversalCount: Number(row.traversal_count),
      lastTraversedAt: row.last_traversed_at,
    }));
  }

  /**
   * Maps database row to Memory object
   */
  /**
   * Record a dedup gate decision
   *
   * @description Inserts one audit row per creation attempt evaluated by the
   * dedup gate. Used for threshold calibration and skip auditing.
   *
   * @param record - Gate decision record
   */
  async recordGateDecision(record: GateDecisionRecord): Promise<void> {
    const schema = this.config.schema || 'memory';
    const query = `
      INSERT INTO ${schema}.gate_decisions
        (entity_id, mode, decision, similarity, matched_memory_id, new_memory_id, candidate_content, threshold)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `;

    await this.client.query(query, [
      record.entityId,
      record.mode,
      record.decision,
      record.similarity,
      record.matchedMemoryId,
      record.newMemoryId,
      record.candidateContent,
      record.threshold,
    ]);
  }

  private mapRowToMemory(row: any): Memory {
    return {
      id: row.id,
      content: row.content,
      entityId: row.entity_id,
      // pgvector returns array directly, pg library handles it
      embedding: row.embedding
        ? Array.isArray(row.embedding)
          ? row.embedding
          : row.embedding
        : undefined,
      outgoingEdges: row.outgoing_edges || [],
      similarity: row.similarity !== undefined ? Number(row.similarity) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
