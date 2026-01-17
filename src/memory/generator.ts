/**
 * Dynamic Memory Generator
 *
 * Collects augmentation data for memory generation.
 * This class is responsible for gathering related memories (vector search + graph traversal)
 * to provide context for AI when creating new memories.
 *
 * @public
 */

import type { MemoryStorage } from './storage';
import type { AugmentationData, Memory } from '../types';

/**
 * Options for collecting augmentation data
 *
 * @public
 */
export interface CollectAugmentationOptions {
  /** Maximum depth for graph traversal (default: 2) */
  maxDepth?: number;
  /** Maximum number of results to collect (default: 50) */
  limit?: number;
}

/**
 * Dynamic Memory Generator
 *
 * Collects related memories using vector search and graph traversal
 * to provide augmentation data for memory generation.
 *
 * @public
 */
export class DynamicMemoryGenerator {
  private storage: MemoryStorage;

  /**
   * Creates a new Dynamic Memory Generator instance
   *
   * @param storage - Memory storage instance for searching memories
   */
  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  /**
   * Collects augmentation data for memory generation
   *
   * Performs vector search and graph traversal to gather related memories
   * that can be used as context when creating a new memory.
   *
   * This method reuses the same logic as `MemoryConnector.getContext()` but
   * returns data in `AugmentationData` format, separating vector and graph memories.
   *
   * @param query - Search query string
   * @param entityId - Entity ID to filter memories
   * @param options - Collection options
   * @returns Augmentation data with vector and graph memories
   *
   * @public
   */
  async collectAugmentation(
    query: string,
    entityId: string,
    options: CollectAugmentationOptions = {},
  ): Promise<AugmentationData> {
    const { maxDepth = 2, limit = 50 } = options;

    // 1. Vector search for relevant memories
    // Use lower threshold to ensure we get some results for augmentation
    const vectorMemories = await this.storage.searchByQuery(
      query,
      entityId,
      limit,
      0.5, // similarity threshold (lowered to ensure results for augmentation context)
    );

    // 2. Graph traversal to get connected memories from all vector memories at once
    // Use DB function to get connected memories from multiple starting points without duplicates
    const vectorMemoryIds = vectorMemories.map(m => m.id);
    const visitedIds = new Set<string>(vectorMemoryIds);

    let graphMemories: Memory[] = [];
    if (vectorMemoryIds.length > 0) {
      // Get all connected memories from vector memories in a single query
      // This is more efficient and handles duplicates at DB level
      const allConnected = await this.storage.getConnectedMemoriesFromMultiple(
        vectorMemoryIds,
        maxDepth,
      );

      // Filter out any memories that are already in vector results
      graphMemories = allConnected.filter(m => !visitedIds.has(m.id));
    }

    // 3. Remove duplicates and apply limits
    // Vector memories are already unique (from searchByQuery)
    // Graph memories are already deduplicated above
    const limitedVectorMemories = vectorMemories.slice(0, limit);
    const limitedGraphMemories = graphMemories.slice(
      0,
      Math.max(0, limit - limitedVectorMemories.length),
    );

    return {
      vectorMemories: limitedVectorMemories,
      graphMemories: limitedGraphMemories,
    };
  }
}
