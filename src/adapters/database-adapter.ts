/**
 * Database Adapter Interface
 *
 * Abstracts database operations for memory storage and retrieval.
 * Implementations can use any database (PostgreSQL, Supabase, etc.)
 */

import type { Memory } from '../types';

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
   * @returns Created memory with generated ID
   */
  createMemory(memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>): Promise<Memory>;

  /**
   * Get a memory by ID
   *
   * @param memoryId - Memory ID
   * @returns Memory or null if not found
   */
  getMemory(memoryId: string): Promise<Memory | null>;

  /**
   * Update an existing memory
   *
   * @param memoryId - Memory ID
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
   * @param memoryId - Memory ID
   * @returns Whether the deletion was successful
   */
  deleteMemory(memoryId: string): Promise<boolean>;

  /**
   * Get all memories for an entity
   *
   * @param entityId - Entity ID (e.g., persona, user, etc.)
   * @returns Array of memories
   */
  getMemoriesByEntity(entityId: string): Promise<Memory[]>;

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
   * @param memoryId - Starting memory ID
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
   * @param memoryIds - Array of starting memory IDs
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
   * @param memoryId - Memory ID to update
   * @param outgoingEdges - New array of connected memory IDs
   * @returns Updated memory
   */
  updateOutgoingEdges(memoryId: string, outgoingEdges: string[]): Promise<Memory>;

  /**
   * Update memory embedding
   *
   * @param memoryId - Memory ID
   * @param embedding - New embedding vector
   * @returns Updated memory
   */
  updateEmbedding(memoryId: string, embedding: number[]): Promise<Memory>;
}
