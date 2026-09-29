/**
 * Database Adapter Interface
 *
 * Abstracts database operations for memory storage and retrieval.
 * Implementations can use any database (PostgreSQL, Supabase, etc.)
 */

import type {
  Memory,
  EdgeTraversalStat,
  GateDecisionRecord,
  MemoryEdge,
  MemoryEdgeInsert,
  MemoryNodeStatus,
  SleepJob,
  SleepJobInsert,
  SleepQueueStats,
  RetrievalShadowRecord,
} from '../types';

/**
 * Database adapter interface for memory operations
 *
 * @public
 */
export interface MemoryStorageAdapter {
  /**
   * Create a new memory
   *
   * @param memory - Memory to create
   * @returns Created memory with generated UUID (not table index)
   */
  createMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory>;

  /**
   * Get a memory by UUID
   *
   * @param memoryId - Memory UUID (not table index)
   * @returns Memory or null if not found
   */
  getMemory(memoryId: string): Promise<Memory | null>;

  /**
   * Update an existing memory
   *
   * @param memoryId - Memory UUID (not table index)
   * @param updates - Partial memory updates
   * @returns Updated memory
   */
  updateMemory(
    memoryId: string,
    updates: Partial<Omit<Memory, 'id' | 'createdAt'>>,
  ): Promise<Memory>;

  /**
   * Delete a memory
   *
   * @param memoryId - Memory UUID (not table index)
   * @returns Whether the deletion was successful
   */
  deleteMemory(memoryId: string): Promise<boolean>;

  /**
   * Get all memories for an entity
   *
   * @param entityId - Entity ID (TEXT, not UUID - e.g., persona ID, user ID, etc.)
   * @returns Array of memories
   */
  getMemoriesByEntity(entityId: string): Promise<Memory[]>;

  /**
   * Count memories for an entity
   *
   * @param entityId - Entity ID (TEXT, not UUID - e.g., persona ID, user ID, etc.)
   * @returns Number of memories stored for the entity
   */
  countMemoriesByEntity(entityId: string): Promise<number>;

  /**
   * Search memories by vector similarity
   *
   * @param embedding - Query embedding vector
   * @param entityId - Entity ID to filter by
   * @param limit - Maximum number of results
   * @param threshold - Similarity threshold (0-1)
   * @returns Array of memories sorted by similarity
   */
  searchByVector(
    embedding: number[],
    entityId: string,
    limit?: number,
    threshold?: number,
  ): Promise<Memory[]>;

  /**
   * Get memories connected via graph edges
   *
   * Traverses the graph by following `outgoingEdges` from the starting memory.
   *
   * @param memoryId - Starting memory UUID (not table index)
   * @param depth - Traversal depth (default: 1)
   * @returns Array of connected memories
   */
  getConnectedMemories(memoryId: string, depth?: number): Promise<Memory[]>;

  /**
   * Get memories connected via graph edges from multiple starting points
   *
   * Traverses the graph from multiple starting memories and returns all connected memories
   * without duplicates. More efficient than calling getConnectedMemories multiple times.
   *
   * @param memoryIds - Array of starting memory UUIDs (not table indexes)
   * @param depth - Traversal depth (default: 1)
   * @returns Array of connected memories (no duplicates, excludes starting memories)
   */
  getConnectedMemoriesFromMultiple(memoryIds: string[], depth?: number): Promise<Memory[]>;

  /**
   * Update memory's outgoing edges
   *
   * Updates the `outgoingEdges` array of a memory to establish or remove connections.
   * This is the primary way to manage relationships between memories.
   *
   * @param memoryId - Memory UUID to update (not table index)
   * @param outgoingEdges - New array of connected memory UUIDs (not table indexes)
   * @returns Updated memory
   */
  updateOutgoingEdges(memoryId: string, outgoingEdges: string[]): Promise<Memory>;

  /**
   * Update memory embedding
   *
   * @param memoryId - Memory UUID (not table index)
   * @param embedding - New embedding vector
   * @returns Updated memory
   */
  updateEmbedding(memoryId: string, embedding: number[]): Promise<Memory>;

  /**
   * Get all unique entity IDs
   *
   * @returns Array of unique entity IDs sorted alphabetically
   */
  getAllEntityIds(): Promise<string[]>;

  /**
   * Record edge traversals for statistics tracking
   *
   * @description Batch UPSERT: increments traversal_count for each edge,
   * or inserts with count=1 if the edge has not been traversed before.
   *
   * @param entityId - Entity ID the edges belong to
   * @param edges - Array of traversed edges (from → to)
   */
  recordEdgeTraversals(entityId: string, edges: Array<{ from: string; to: string }>): Promise<void>;

  /**
   * Get edge traversal statistics for an entity
   *
   * @description Returns all recorded edge traversals sorted by traversal_count DESC.
   *
   * @param entityId - Entity ID to query
   * @returns Array of edge traversal statistics
   */
  getEdgeTraversalStats(entityId: string): Promise<EdgeTraversalStat[]>;

  /**
   * Record a dedup gate decision
   *
   * @description Inserts one row per creation attempt evaluated by the dedup
   * gate, for audit and threshold calibration.
   *
   * @param record - Gate decision record
   */
  recordGateDecision(record: GateDecisionRecord): Promise<void>;

  /**
   * Insert edges idempotently
   *
   * @description ON CONFLICT (from_id, to_id, type) DO NOTHING — safe to
   * re-run with overlapping input.
   *
   * @param edges - Edge inserts
   * @returns Number of rows actually inserted
   */
  insertEdges(edges: MemoryEdgeInsert[]): Promise<number>;

  /**
   * Get all edges for an entity
   *
   * @param entityId - Entity ID to query
   * @returns Edges ordered by creation time
   */
  getEdgesByEntity(entityId: string): Promise<MemoryEdge[]>;

  /**
   * Count edges for an entity
   *
   * @param entityId - Entity ID to query
   * @returns Number of edges stored for the entity
   */
  countEdgesByEntity(entityId: string): Promise<number>;

  /**
   * Delete an edge by its natural key (from, to, type)
   *
   * @param fromId - Source memory UUID
   * @param toId - Target memory UUID
   * @param type - Edge type
   */
  deleteEdge(fromId: string, toId: string, type: string): Promise<void>;

  /**
   * Increase a memory's own strength (clamped to 1.0), updating the
   * strength timestamp
   *
   * @param memoryId - Memory UUID to reinforce
   * @param amount - Amount to add (0-1)
   */
  bumpMemoryStrength(memoryId: string, amount: number): Promise<void>;

  /**
   * Enqueue a sleep worker job
   *
   * @param job - Job to enqueue
   */
  enqueueSleepJob(job: SleepJobInsert): Promise<void>;

  /**
   * Get memories by their UUIDs
   *
   * @param memoryIds - Memory UUIDs
   * @returns Matching memories (order not guaranteed)
   */
  getMemoriesByIds(memoryIds: string[]): Promise<Memory[]>;

  /**
   * Get all edges touching any of the given memories (either direction)
   *
   * @param memoryIds - Memory UUIDs
   * @returns Edges where from_id or to_id is one of the given ids
   */
  getEdgesTouching(memoryIds: string[]): Promise<MemoryEdge[]>;

  /**
   * Record that memories were retrieved (usage signal)
   *
   * @param memoryIds - Retrieved memory UUIDs
   */
  recordNodeRetrievals(memoryIds: string[]): Promise<void>;

  /**
   * Increase edge strengths (clamped to 1.0) — traversal usage signal
   *
   * @param edgeIds - Edge UUIDs to bump
   * @param amount - Amount to add (0-1)
   */
  bumpEdgeStrengths(edgeIds: string[], amount: number): Promise<void>;

  /**
   * Record a retrieval shadow comparison (legacy vs ranked)
   *
   * @param record - Shadow comparison record
   */
  recordRetrievalShadow(record: RetrievalShadowRecord): Promise<void>;

  /**
   * Set a memory's node status (demotion is a ranking penalty, never a delete)
   *
   * @param memoryId - Memory UUID
   * @param status - New status
   */
  setMemoryStatus(memoryId: string, status: MemoryNodeStatus): Promise<void>;

  /**
   * Aggregate view of an entity's sleep queue (one indexed query). A
   * `processing` row whose claim is older than `staleAfterSeconds` counts as
   * pending so a crashed executor's jobs still wake the next run.
   *
   * @param entityId - Entity id
   * @param staleAfterSeconds - Age after which a `processing` claim is reclaimable
   * @returns Pending (incl. reclaimable) count, oldest pending time, last completion time
   */
  getSleepQueueStats(entityId: string, staleAfterSeconds: number): Promise<SleepQueueStats>;

  /**
   * Atomically claim up to `limit` jobs of an entity (pending, or processing
   * with a claim older than `staleAfterSeconds`) — oldest first
   *
   * @param entityId - Entity id
   * @param limit - Max jobs to claim
   * @param staleAfterSeconds - Age after which a `processing` claim is reclaimable
   * @returns Claimed jobs (status already `processing`)
   */
  claimSleepJobs(entityId: string, limit: number, staleAfterSeconds: number): Promise<SleepJob[]>;

  /**
   * Read-only view of the jobs a claim would take (same selection, no lock,
   * no status change) — used for dry-run previews
   *
   * @param entityId - Entity id
   * @param limit - Max jobs
   * @param staleAfterSeconds - Age after which a `processing` claim is reclaimable
   * @returns Claimable jobs, oldest first
   */
  listClaimableSleepJobs(
    entityId: string,
    limit: number,
    staleAfterSeconds: number,
  ): Promise<SleepJob[]>;

  /**
   * Finish a claimed job with its verdict (terminal; never re-enqueued)
   *
   * @param jobId - Job UUID
   * @param status - Terminal status
   * @param verdict - Kind-specific verdict record
   */
  completeSleepJob(
    jobId: string,
    status: 'done' | 'skipped' | 'failed',
    verdict: Record<string, unknown>,
  ): Promise<void>;

  /**
   * Count jobs finished since a point in time (global budget accounting)
   *
   * @param since - Lower bound (inclusive) on completion time
   * @returns Number of jobs in a terminal status completed at or after `since`
   */
  countSleepJobsProcessedSince(since: Date): Promise<number>;
}
