/**
 * Memory Storage
 *
 * High-level API for Memory operations that automatically handles embedding generation.
 * This layer sits above the storage adapter and provides a more convenient API
 * that handles embedding generation internally.
 */

import type { MemoryStorageAdapter } from '../adapters/database-adapter';
import type { Memory } from '../types';
import type { EmbeddingService } from '../vector/embedding-service';

/**
 * Options for creating a memory
 *
 * @public
 */
export interface CreateMemoryOptions {
  /** Whether to automatically generate embedding if not provided */
  autoGenerateEmbedding?: boolean;
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
   * @returns Created memory with generated ID and embedding
   *
   * @public
   */
  async createMemory(
    memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>,
    options: CreateMemoryOptions = {},
  ): Promise<Memory> {
    const { autoGenerateEmbedding = true } = options;

    // Auto-generate embedding if not provided and service is available
    let embedding = memory.embedding;
    if (!embedding && autoGenerateEmbedding && this.embeddingService) {
      embedding = await this.embeddingService.generateEmbedding(memory.content);
    }

    return this.adapter.createMemory({
      ...memory,
      embedding,
    });
  }

  /**
   * Get a memory by ID
   *
   * @param memoryId - Memory ID
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
   * @param memoryId - Memory ID
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
   * @param memoryId - Memory ID
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
   * @param entityId - Entity ID
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
   * @param threshold - Similarity threshold (0-1)
   * @returns Array of memories sorted by similarity
   *
   * @public
   */
  async searchByQuery(
    query: string | number[],
    entityId: string,
    limit: number = 10,
    threshold: number = 0.7,
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

    return this.adapter.searchByVector(embedding, entityId, limit, threshold);
  }

  /**
   * Get memories connected via graph edges
   *
   * @param memoryId - Starting memory ID
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
   * @param memoryIds - Array of starting memory IDs
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
   * @param memoryId - Memory ID to update
   * @param outgoingEdges - New array of connected memory IDs
   * @returns Updated memory
   *
   * @public
   */
  async updateOutgoingEdges(memoryId: string, outgoingEdges: string[]): Promise<Memory> {
    return this.adapter.updateOutgoingEdges(memoryId, outgoingEdges);
  }
}
