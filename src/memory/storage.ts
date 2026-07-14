/**
 * Memory Storage
 *
 * High-level API for Memory operations that automatically handles embedding generation.
 * This layer sits above the storage adapter and provides a more convenient API
 * that handles embedding generation internally.
 */

import type { MemoryStorageAdapter } from '../adapters/database-adapter';
import { Memory, SearchMode } from '../types';
import { getThresholdFromMode } from '../types';
import type {
  EdgeTraversalStat,
  GateDecisionRecord,
  MemoryEdge,
  MemoryEdgeInsert,
  SleepJobInsert,
  RetrievalShadowRecord,
} from '../types';
import type { EmbeddingService } from '../vector/embedding-service';

/**
 * Options for creating a memory
 *
 * @public
 */
export interface CreateMemoryOptions {
  /** Whether to automatically link to related memories */
  autoLink?: boolean;
}

/**
 * Memory Storage
 *
 * Provides high-level Memory operations with automatic embedding generation.
 * Application Layer should use this instead of directly using MemoryStorageAdapter.
 *
 * @public
 */
export class MemoryStorage {
  private adapter: MemoryStorageAdapter;
  private embeddingService?: EmbeddingService;

  /**
   * Creates a new Memory Storage instance
   *
   * @param adapter - Storage adapter for database operations
   * @param embeddingService - Optional embedding service for automatic embedding generation
   */
  constructor(adapter: MemoryStorageAdapter, embeddingService?: EmbeddingService) {
    this.adapter = adapter;
    this.embeddingService = embeddingService;
  }

  /**
   * Create a new memory
   *
   * Automatically generates embedding if not provided and embeddingService is available.
   *
   * @param memory - Memory to create (embedding is optional)
   * @param options - Creation options
   * @returns Created memory with generated UUID (not table index) and embedding
   *
   * @public
   */
  async createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>,
    options: CreateMemoryOptions = {},
  ): Promise<Memory> {
    // Always generate embedding when not provided and service is available
    let embedding = memory.embedding;
    if (!embedding && this.embeddingService) {
      embedding = await this.embeddingService.generateEmbedding(memory.content);
    }

    return this.adapter.createMemory({
      ...memory,
      embedding,
    });
  }

  /**
   * Get a memory by UUID
   *
   * @param memoryId - Memory UUID (not table index)
   * @returns Memory or null if not found
   *
   * @public
   */
  async getMemory(memoryId: string): Promise<Memory | null> {
    return this.adapter.getMemory(memoryId);
  }

  /**
   * Update an existing memory
   *
   * Automatically regenerates embedding if content is updated and embeddingService is available.
   *
   * @param memoryId - Memory UUID (not table index)
   * @param updates - Partial memory updates
   * @returns Updated memory
   *
   * @public
   */
  async updateMemory(
    memoryId: string,
    updates: Partial<Omit<Memory, 'id' | 'createdAt'>>,
  ): Promise<Memory> {
    // If content is updated, regenerate embedding if service is available
    if (updates.content && this.embeddingService && !updates.embedding) {
      updates.embedding = await this.embeddingService.generateEmbedding(updates.content);
    }

    return this.adapter.updateMemory(memoryId, updates);
  }

  /**
   * Delete a memory
   *
   * @param memoryId - Memory UUID (not table index)
   * @returns Whether the deletion was successful
   *
   * @public
   */
  async deleteMemory(memoryId: string): Promise<boolean> {
    return this.adapter.deleteMemory(memoryId);
  }

  /**
   * Get all memories for an entity
   *
   * @param entityId - Entity ID (TEXT, not UUID - e.g., persona ID, user ID, etc.)
   * @returns Array of memories
   *
   * @public
   */
  async getMemoriesByEntity(entityId: string): Promise<Memory[]> {
    return this.adapter.getMemoriesByEntity(entityId);
  }

  /**
   * Search memories by vector similarity
   *
   * Automatically generates query embedding if embeddingService is available.
   *
   * @param query - Search query (text or embedding vector)
   * @param entityId - Entity ID to filter by
   * @param limit - Maximum number of results
   * @param searchMode - SearchMode enum for controlling search behavior (default: SearchMode.CONSERVATIVE)
   * @returns Array of memories sorted by similarity
   *
   * @public
   */
  async searchByQuery(
    query: string | number[],
    entityId: string,
    limit: number = 10,
    searchMode: SearchMode = SearchMode.CONSERVATIVE,
  ): Promise<Memory[]> {
    let embedding: number[];

    if (typeof query === 'string') {
      // Generate embedding from text query
      if (!this.embeddingService) {
        throw new Error(
          'EmbeddingService is required for text query search. Provide embeddingService when initializing MemoryStorage.',
        );
      }
      embedding = await this.embeddingService.generateQueryEmbedding(query);
    } else {
      // Use provided embedding
      embedding = query;
    }

    // Convert SearchMode to threshold
    const threshold = getThresholdFromMode(searchMode);

    return this.adapter.searchByVector(embedding, entityId, limit, threshold);
  }

  /**
   * Get memories connected via graph edges
   *
   * @param memoryId - Starting memory UUID (not table index)
   * @param depth - Traversal depth (default: 1)
   * @returns Array of connected memories
   *
   * @public
   */
  async getConnectedMemories(memoryId: string, depth: number = 1): Promise<Memory[]> {
    return this.adapter.getConnectedMemories(memoryId, depth);
  }

  /**
   * Get memories connected via graph edges from multiple starting points
   *
   * More efficient than calling getConnectedMemories multiple times.
   * Returns all connected memories without duplicates.
   *
   * @param memoryIds - Array of starting memory UUIDs (not table indexes)
   * @param depth - Traversal depth (default: 1)
   * @returns Array of connected memories (no duplicates, excludes starting memories)
   *
   * @public
   */
  async getConnectedMemoriesFromMultiple(
    memoryIds: string[],
    depth: number = 1,
  ): Promise<Memory[]> {
    return this.adapter.getConnectedMemoriesFromMultiple(memoryIds, depth);
  }

  /**
   * Update memory's outgoing edges
   *
   * @param memoryId - Memory UUID to update (not table index)
   * @param outgoingEdges - New array of connected memory UUIDs (not table indexes)
   * @returns Updated memory
   *
   * @public
   */
  async updateOutgoingEdges(memoryId: string, outgoingEdges: string[]): Promise<Memory> {
    return this.adapter.updateOutgoingEdges(memoryId, outgoingEdges);
  }

  async getAllEntityIds(): Promise<string[]> {
    return this.adapter.getAllEntityIds();
  }

  /**
   * Record edge traversals for statistics tracking
   *
   * @description Delegates to the adapter to batch-upsert traversal counts.
   *
   * @param entityId - Entity ID the edges belong to
   * @param edges - Array of traversed edges (from → to)
   *
   * @public
   */
  async recordEdgeTraversals(
    entityId: string,
    edges: Array<{ from: string; to: string }>,
  ): Promise<void> {
    return this.adapter.recordEdgeTraversals(entityId, edges);
  }

  /**
   * Get edge traversal statistics for an entity
   *
   * @description Delegates to the adapter to retrieve all edge traversal records
   * sorted by traversal_count DESC.
   *
   * @param entityId - Entity ID to query
   * @returns Array of edge traversal statistics
   *
   * @public
   */
  async getEdgeTraversalStats(entityId: string): Promise<EdgeTraversalStat[]> {
    return this.adapter.getEdgeTraversalStats(entityId);
  }

  /**
   * Find the single most similar memory to the given content within an entity
   *
   * Generates an embedding for the content and returns it together with the
   * nearest neighbor (no similarity threshold applied), so callers can reuse
   * the embedding for a subsequent createMemory without a second embedding call.
   *
   * @param content - Content to compare against existing memories
   * @param entityId - Entity ID to search within
   * @returns Generated embedding and the most similar memory (null when none)
   * @throws Error if embeddingService is not available
   *
   * @public
   */
  async findMostSimilarMemory(
    content: string,
    entityId: string,
  ): Promise<{ embedding: number[]; match: Memory | null }> {
    const { embedding, matches } = await this.findMostSimilarMemories(content, entityId, 1);
    return { embedding, match: matches[0] ?? null };
  }

  /**
   * Find the k most similar memories to the given content within an entity
   *
   * Generates an embedding for the content and returns it together with the
   * nearest neighbors ordered by similarity (no threshold applied), so
   * callers can reuse the embedding for a subsequent createMemory.
   *
   * @param content - Content to compare against existing memories
   * @param entityId - Entity ID to search within
   * @param k - Maximum number of neighbors to return
   * @returns Generated embedding and nearest neighbors (may be empty)
   * @throws Error if embeddingService is not available
   *
   * @public
   */
  async findMostSimilarMemories(
    content: string,
    entityId: string,
    k: number,
  ): Promise<{ embedding: number[]; matches: Memory[] }> {
    if (!this.embeddingService) {
      throw new Error(
        'EmbeddingService is required for findMostSimilarMemories. Provide embeddingService when initializing MemoryStorage.',
      );
    }
    const embedding = await this.embeddingService.generateEmbedding(content);
    const matches = await this.adapter.searchByVector(embedding, entityId, k, 0);
    return { embedding, matches };
  }

  /**
   * Increase a memory's own strength (clamped to 1.0)
   *
   * Used when a duplicate creation is skipped: the repeated mention is
   * treated as reinforcement of the existing memory instead of a new node.
   *
   * @param memoryId - Memory UUID to reinforce
   * @param amount - Amount to add (0-1)
   *
   * @public
   */
  async bumpMemoryStrength(memoryId: string, amount: number): Promise<void> {
    return this.adapter.bumpMemoryStrength(memoryId, amount);
  }

  /**
   * Enqueue a sleep worker job (e.g. merge review for a gray-zone pair)
   *
   * @param job - Job to enqueue
   *
   * @public
   */
  async enqueueSleepJob(job: SleepJobInsert): Promise<void> {
    return this.adapter.enqueueSleepJob(job);
  }

  /**
   * Delete an edge by its natural key
   *
   * @param fromId - Source memory UUID
   * @param toId - Target memory UUID
   * @param type - Edge type (default: 'related')
   *
   * @public
   */
  async deleteEdge(fromId: string, toId: string, type: string = 'related'): Promise<void> {
    return this.adapter.deleteEdge(fromId, toId, type);
  }

  /**
   * Record a dedup gate decision for audit and threshold calibration
   *
   * @param record - Gate decision record
   *
   * @public
   */
  async recordGateDecision(record: GateDecisionRecord): Promise<void> {
    return this.adapter.recordGateDecision(record);
  }

  /**
   * Insert edges idempotently (first-class edges table)
   *
   * @param edges - Edge inserts (defaults: type 'related', strength 0.5)
   * @returns Number of rows actually inserted (conflicts excluded)
   *
   * @public
   */
  async insertEdges(edges: MemoryEdgeInsert[]): Promise<number> {
    return this.adapter.insertEdges(edges);
  }

  /**
   * Get all edges for an entity
   *
   * @param entityId - Entity ID to query
   * @returns Edges ordered by creation time
   *
   * @public
   */
  async getEdgesByEntity(entityId: string): Promise<MemoryEdge[]> {
    return this.adapter.getEdgesByEntity(entityId);
  }

  /**
   * Get memories by their UUIDs
   *
   * @param memoryIds - Memory UUIDs
   * @returns Matching memories (order not guaranteed)
   *
   * @public
   */
  async getMemoriesByIds(memoryIds: string[]): Promise<Memory[]> {
    return this.adapter.getMemoriesByIds(memoryIds);
  }

  /**
   * Get all edges touching any of the given memories (either direction)
   *
   * @param memoryIds - Memory UUIDs
   * @returns Edges where either end is one of the given ids
   *
   * @public
   */
  async getEdgesTouching(memoryIds: string[]): Promise<MemoryEdge[]> {
    return this.adapter.getEdgesTouching(memoryIds);
  }

  /**
   * Record that memories were retrieved (usage signal for ranking/forgetting)
   *
   * @param memoryIds - Retrieved memory UUIDs
   *
   * @public
   */
  async recordNodeRetrievals(memoryIds: string[]): Promise<void> {
    return this.adapter.recordNodeRetrievals(memoryIds);
  }

  /**
   * Increase edge strengths (clamped to 1.0) — traversal usage signal
   *
   * @param edgeIds - Edge UUIDs to bump
   * @param amount - Amount to add (0-1)
   *
   * @public
   */
  async bumpEdgeStrengths(edgeIds: string[], amount: number): Promise<void> {
    return this.adapter.bumpEdgeStrengths(edgeIds, amount);
  }

  /**
   * Record a retrieval shadow comparison (legacy vs ranked)
   *
   * @param record - Shadow comparison record
   *
   * @public
   */
  async recordRetrievalShadow(record: RetrievalShadowRecord): Promise<void> {
    return this.adapter.recordRetrievalShadow(record);
  }
}
