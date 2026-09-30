/**
 * PostgreSQL Storage Adapter
 *
 * Implements MemoryStorageAdapter using PostgreSQL with pgvector extension.
 * This adapter handles all memory operations including vector search and graph traversal.
 */

import type { MemoryStorageAdapter } from '../../adapters/database-adapter';
import type {
  Memory,
  EdgeTraversalStat,
  GateDecisionRecord,
  MemoryEdge,
  MemoryEdgeInsert,
  SleepJobInsert,
  RetrievalShadowRecord,
  MemoryNodeStatus,
  SleepJob,
  SleepQueueStats,
} from '../../types';
import type { PostgresStorageConfig } from '../storage-types';
import { initDatabase, ensureTablesExist } from '../migrations/postgres-init';

/**
 * PostgreSQL adapter for memory storage
 *
 * @public
 */
export class PostgresAdapter implements MemoryStorageAdapter {
  private config: PostgresStorageConfig;
  private client: any; // pg.Pool — .query()/.end() are Client-compatible; connections auto-recover

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

  async countMemoriesByEntity(entityId: string): Promise<number> {
    const schema = this.config.schema || 'memory';
    const query = `
      SELECT count(*)::int AS count
      FROM ${schema}.memories
      WHERE entity_id = $1
    `;

    const result = await this.client.query(query, [entityId]);
    return result.rows[0].count;
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
   * Insert edges idempotently. On conflict (from/to/type) the stored strength
   * is raised to the maximum of both values — a re-confirmed link (e.g. a
   * conversation link over a backfilled hypothesis) upgrades strength while
   * the original origin (provenance) is preserved. Strength never decreases,
   * so re-running lower-strength inserts (backfill) stays a no-op.
   *
   * @param edges - Edge inserts (defaults: type 'related', strength 0.5)
   * @returns Number of rows inserted or strengthened
   */
  async insertEdges(edges: MemoryEdgeInsert[]): Promise<number> {
    if (edges.length === 0) return 0;

    const schema = this.config.schema || 'memory';
    const values: any[] = [];
    const placeholders: string[] = [];
    let i = 1;

    for (const edge of edges) {
      placeholders.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
      values.push(
        edge.entityId,
        edge.fromId,
        edge.toId,
        edge.type ?? 'related',
        edge.origin,
        edge.strength ?? 0.5,
      );
    }

    const result = await this.client.query(
      `
      INSERT INTO ${schema}.edges (entity_id, from_id, to_id, type, origin, strength)
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (from_id, to_id, type) DO UPDATE SET
        strength = GREATEST(${schema}.edges.strength, EXCLUDED.strength),
        strength_updated_at = NOW()
      WHERE EXCLUDED.strength > ${schema}.edges.strength
      `,
      values,
    );

    return result.rowCount ?? 0;
  }

  /**
   * Get all edges for an entity
   *
   * @param entityId - Entity ID to query
   * @returns Edges ordered by creation time
   */
  async getEdgesByEntity(entityId: string): Promise<MemoryEdge[]> {
    const schema = this.config.schema || 'memory';
    const result = await this.client.query(
      `
      SELECT id, entity_id, from_id, to_id, type, origin, strength, created_at, strength_updated_at
      FROM ${schema}.edges
      WHERE entity_id = $1
      ORDER BY created_at
      `,
      [entityId],
    );

    return result.rows.map((row: any) => this.mapRowToEdge(row));
  }

  async countEdgesByEntity(entityId: string): Promise<number> {
    const schema = this.config.schema || 'memory';
    const query = `
      SELECT count(*)::int AS count
      FROM ${schema}.edges
      WHERE entity_id = $1
    `;

    const result = await this.client.query(query, [entityId]);
    return result.rows[0].count;
  }

  private mapRowToEdge(row: any): MemoryEdge {
    return {
      id: row.id,
      entityId: row.entity_id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.type,
      origin: row.origin,
      strength: Number(row.strength),
      createdAt: row.created_at,
      strengthUpdatedAt: row.strength_updated_at,
    };
  }

  /**
   * Get memories by their UUIDs
   */
  async getMemoriesByIds(memoryIds: string[]): Promise<Memory[]> {
    if (memoryIds.length === 0) return [];
    const schema = this.config.schema || 'memory';
    const result = await this.client.query(`SELECT * FROM ${schema}.memories WHERE id = ANY($1)`, [
      memoryIds,
    ]);
    return result.rows.map((row: any) => this.mapRowToMemory(row));
  }

  /**
   * Get all edges touching any of the given memories (either direction)
   */
  async getEdgesTouching(memoryIds: string[]): Promise<MemoryEdge[]> {
    if (memoryIds.length === 0) return [];
    const schema = this.config.schema || 'memory';
    const result = await this.client.query(
      `
      SELECT id, entity_id, from_id, to_id, type, origin, strength, created_at, strength_updated_at
      FROM ${schema}.edges
      WHERE from_id = ANY($1) OR to_id = ANY($1)
      `,
      [memoryIds],
    );
    return result.rows.map((row: any) => this.mapRowToEdge(row));
  }

  /**
   * Record that memories were retrieved (usage signal for ranking/forgetting)
   */
  async recordNodeRetrievals(memoryIds: string[]): Promise<void> {
    if (memoryIds.length === 0) return;
    const schema = this.config.schema || 'memory';
    await this.client.query(
      `
      UPDATE ${schema}.memories
      SET retrieval_count = retrieval_count + 1,
          last_retrieved_at = NOW()
      WHERE id = ANY($1)
      `,
      [memoryIds],
    );
  }

  /**
   * Reinforce edges by usage — diminishing bump.
   *
   * Each use closes a fixed fraction (`amount`) of the remaining headroom:
   * strength += amount × (1 − strength). Strength approaches 1.0 asymptotically
   * and never saturates, so the stored value keeps discriminating heavily used
   * edges from moderately used ones without any timing or counter state. The
   * decay clock is reset on every bump as before.
   */
  async bumpEdgeStrengths(edgeIds: string[], amount: number): Promise<void> {
    if (edgeIds.length === 0) return;
    const schema = this.config.schema || 'memory';
    await this.client.query(
      `
      UPDATE ${schema}.edges
      SET strength = LEAST(1.0, strength + $2 * (1.0 - strength)),
          strength_updated_at = NOW()
      WHERE id = ANY($1)
      `,
      [edgeIds, amount],
    );
  }

  /**
   * Record a retrieval shadow comparison (legacy vs ranked)
   */
  async recordRetrievalShadow(record: RetrievalShadowRecord): Promise<void> {
    const schema = this.config.schema || 'memory';
    await this.client.query(
      `
      INSERT INTO ${schema}.retrieval_shadow_log (entity_id, query, legacy_ids, ranked_ids, overlap)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [record.entityId, record.query, record.legacyIds, record.rankedIds, record.overlap],
    );
  }

  /**
   * Delete an edge by its natural key (from, to, type)
   */
  async deleteEdge(fromId: string, toId: string, type: string): Promise<void> {
    const schema = this.config.schema || 'memory';
    await this.client.query(
      `DELETE FROM ${schema}.edges WHERE from_id = $1 AND to_id = $2 AND type = $3`,
      [fromId, toId, type],
    );
  }

  /**
   * Increase a memory's own strength (clamped to 1.0)
   */
  async bumpMemoryStrength(memoryId: string, amount: number): Promise<void> {
    const schema = this.config.schema || 'memory';
    // A re-mention is evidence the topic returned: it also lifts a demotion.
    await this.client.query(
      `
      UPDATE ${schema}.memories
      SET strength = LEAST(1.0, strength + $2),
          strength_updated_at = NOW(),
          status = 'active'
      WHERE id = $1
      `,
      [memoryId, amount],
    );
  }

  /**
   * Set a memory's node status. Demotion is a ranking penalty, never a delete.
   */
  async setMemoryStatus(memoryId: string, status: MemoryNodeStatus): Promise<void> {
    const schema = this.config.schema || 'memory';
    await this.client.query(`UPDATE ${schema}.memories SET status = $2 WHERE id = $1`, [
      memoryId,
      status,
    ]);
  }

  /**
   * Aggregate view of an entity's sleep queue (single indexed query). Stale
   * `processing` claims count as pending so they are never stranded.
   */
  async getSleepQueueStats(entityId: string, staleAfterSeconds: number): Promise<SleepQueueStats> {
    const schema = this.config.schema || 'memory';
    const result = await this.client.query(
      `
      SELECT
        count(*) FILTER (
          WHERE status = 'pending'
             OR (status = 'processing' AND processed_at < NOW() - make_interval(secs => $2))
        )::int AS pending,
        min(created_at) FILTER (
          WHERE status = 'pending'
             OR (status = 'processing' AND processed_at < NOW() - make_interval(secs => $2))
        ) AS oldest_pending_at,
        max(processed_at) FILTER (WHERE status IN ('done', 'skipped', 'failed')) AS last_processed_at
      FROM ${schema}.sleep_jobs
      WHERE entity_id = $1
      `,
      [entityId, staleAfterSeconds],
    );
    const row = result.rows[0] ?? {};
    return {
      pending: Number(row.pending ?? 0),
      oldestPendingAt: row.oldest_pending_at ?? null,
      lastProcessedAt: row.last_processed_at ?? null,
    };
  }

  /**
   * Atomically claim jobs: pending → processing (oldest first). A `processing`
   * row whose claim is older than `staleAfterSeconds` is reclaimable, so a
   * crashed executor never strands a job. `processed_at` doubles as the claim
   * time while processing and becomes the completion time on finish.
   */
  async claimSleepJobs(
    entityId: string,
    limit: number,
    staleAfterSeconds: number,
  ): Promise<SleepJob[]> {
    if (limit <= 0) return [];
    const schema = this.config.schema || 'memory';
    const result = await this.client.query(
      `
      UPDATE ${schema}.sleep_jobs
      SET status = 'processing', processed_at = NOW()
      WHERE id IN (
        SELECT id FROM ${schema}.sleep_jobs
        WHERE entity_id = $1
          AND (
            status = 'pending'
            OR (status = 'processing' AND processed_at < NOW() - make_interval(secs => $3))
          )
        ORDER BY created_at ASC
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, entity_id, kind, payload, status, verdict, created_at, processed_at
      `,
      [entityId, limit, staleAfterSeconds],
    );
    return (result.rows as Record<string, unknown>[]).map(row => this.mapRowToSleepJob(row));
  }

  /**
   * Read-only peek at claimable jobs (dry-run preview). No lock, no writes.
   */
  async listClaimableSleepJobs(
    entityId: string,
    limit: number,
    staleAfterSeconds: number,
  ): Promise<SleepJob[]> {
    if (limit <= 0) return [];
    const schema = this.config.schema || 'memory';
    const result = await this.client.query(
      `
      SELECT id, entity_id, kind, payload, status, verdict, created_at, processed_at
      FROM ${schema}.sleep_jobs
      WHERE entity_id = $1
        AND (
          status = 'pending'
          OR (status = 'processing' AND processed_at < NOW() - make_interval(secs => $3))
        )
      ORDER BY created_at ASC
      LIMIT $2
      `,
      [entityId, limit, staleAfterSeconds],
    );
    return (result.rows as Record<string, unknown>[]).map(row => this.mapRowToSleepJob(row));
  }

  /**
   * Finish a claimed job with its verdict (terminal)
   */
  async completeSleepJob(
    jobId: string,
    status: 'done' | 'skipped' | 'failed',
    verdict: Record<string, unknown>,
  ): Promise<void> {
    const schema = this.config.schema || 'memory';
    await this.client.query(
      `UPDATE ${schema}.sleep_jobs SET status = $2, verdict = $3, processed_at = NOW() WHERE id = $1`,
      [jobId, status, JSON.stringify(verdict)],
    );
  }

  /**
   * Count jobs finished at or after `since` (global budget accounting)
   */
  async countSleepJobsProcessedSince(since: Date): Promise<number> {
    const schema = this.config.schema || 'memory';
    const result = await this.client.query(
      `
      SELECT count(*)::int AS n FROM ${schema}.sleep_jobs
      WHERE status IN ('done', 'skipped', 'failed') AND processed_at >= $1
      `,
      [since],
    );
    return Number(result.rows[0]?.n ?? 0);
  }

  private mapRowToSleepJob(row: Record<string, unknown>): SleepJob {
    return {
      id: row.id as string,
      entityId: row.entity_id as string,
      kind: row.kind as string,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      status: row.status as SleepJob['status'],
      verdict: (row.verdict as Record<string, unknown> | null | undefined) ?? null,
      createdAt: row.created_at as Date,
      processedAt: (row.processed_at as Date | null | undefined) ?? null,
    };
  }

  /**
   * Enqueue a sleep worker job
   */
  async enqueueSleepJob(job: SleepJobInsert): Promise<void> {
    const schema = this.config.schema || 'memory';
    await this.client.query(
      `INSERT INTO ${schema}.sleep_jobs (entity_id, kind, payload) VALUES ($1, $2, $3)`,
      [job.entityId, job.kind, JSON.stringify(job.payload)],
    );
  }

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
      // Dynamic state columns (v2+); undefined when selecting from older schemas
      strength:
        row.strength !== undefined && row.strength !== null ? Number(row.strength) : undefined,
      strengthUpdatedAt: row.strength_updated_at ?? undefined,
      retrievalCount:
        row.retrieval_count !== undefined && row.retrieval_count !== null
          ? Number(row.retrieval_count)
          : undefined,
      lastRetrievedAt: row.last_retrieved_at ?? undefined,
      status: row.status ?? undefined,
    };
  }
}
