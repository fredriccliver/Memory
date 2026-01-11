/**
 * Database Adapter Interface
 *
 * Abstracts database operations for memory storage and retrieval.
 * Implementations can use any database (PostgreSQL, Supabase, etc.)
 */

import type { Memory, Relationship } from '../types';

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
   * Get all memories for a persona
   *
   * @param personaId - Persona ID
   * @returns Array of memories
   */
  getMemoriesByPersona(personaId: string): Promise<Memory[]>;

  /**
   * Search memories by vector similarity
   *
   * @param embedding - Query embedding vector
   * @param personaId - Persona ID to filter by
   * @param limit - Maximum number of results
   * @param threshold - Similarity threshold (0-1)
   * @returns Array of memories sorted by similarity
   */
  searchByVector(
    embedding: number[],
    personaId: string,
    limit?: number,
    threshold?: number,
  ): Promise<Memory[]>;

  /**
   * Get memories connected via graph edges
   *
   * @param memoryId - Starting memory ID
   * @param depth - Traversal depth
   * @returns Array of connected memories
   */
  getConnectedMemories(memoryId: string, depth?: number): Promise<Memory[]>;

  /**
   * Create a relationship between memories
   *
   * @param relationship - Relationship to create
   * @returns Created relationship
   */
  createRelationship(relationship: Relationship): Promise<Relationship>;

  /**
   * Delete a relationship
   *
   * @param from - Source memory ID
   * @param to - Target memory ID
   * @returns Whether the deletion was successful
   */
  deleteRelationship(from: string, to: string): Promise<boolean>;

  /**
   * Update memory embedding
   *
   * @param memoryId - Memory ID
   * @param embedding - New embedding vector
   * @returns Updated memory
   */
  updateEmbedding(memoryId: string, embedding: number[]): Promise<Memory>;
}
