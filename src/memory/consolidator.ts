/**
 * Memory Consolidator
 *
 * Handles background-style memory consolidation - scanning entity memories
 * and linking related memories based on vector similarity.
 * Similar to how humans consolidate memories during sleep.
 *
 * @public
 */

import type { MemoryStorage } from './storage';
import type { Memory } from '../types';
import { SearchMode } from '../types';

/**
 * Options for memory consolidation
 *
 * @public
 */
export interface ConsolidateMemoriesOptions {
  /**
   * Similarity threshold for linking memories (0-1)
   * Higher values = stricter matching, fewer links
   * Lower values = looser matching, more links
   * @default 0.7
   */
  similarityThreshold?: number;

  /**
   * Maximum number of links to add per memory
   * Prevents creating too many connections
   * @default 5
   */
  maxLinksPerMemory?: number;

  /**
   * Whether to create bidirectional links (A→B and B→A)
   * @default true
   */
  bidirectional?: boolean;

  /**
   * Skip memories that already have this many or more outgoing edges
   * Set to 0 to process all memories regardless of existing links
   * @default 0 (process all)
   */
  skipIfEdgeCountAbove?: number;

  /**
   * Callback for progress reporting
   */
  onProgress?: (progress: ConsolidationProgress) => void;
}

/**
 * Progress information during consolidation
 *
 * @public
 */
export interface ConsolidationProgress {
  /** Current memory index being processed */
  current: number;
  /** Total number of memories to process */
  total: number;
  /** ID of memory currently being processed */
  memoryId: string;
  /** Number of new links created so far */
  linksCreated: number;
}

/**
 * Result of memory consolidation
 *
 * @public
 */
export interface ConsolidateMemoriesResult {
  /** Whether the operation was successful */
  success: boolean;
  /** Total memories processed */
  memoriesProcessed: number;
  /** Total new links created */
  linksCreated: number;
  /** Memories that were linked (with their new connections) */
  linkedMemories: Array<{
    memoryId: string;
    newLinks: string[];
  }>;
  /** Error message if failed */
  error?: string;
  /** Duration in milliseconds */
  durationMs: number;
}

/**
 * Memory Consolidator
 *
 * Scans entity memories and creates links between related memories
 * based on vector similarity. Designed to be called periodically
 * (like background maintenance) or manually triggered.
 *
 * @public
 */
export class MemoryConsolidator {
  private storage: MemoryStorage;

  /**
   * Creates a new Memory Consolidator instance
   *
   * @param storage - Memory storage instance for database operations
   */
  constructor(storage: MemoryStorage) {
    this.storage = storage;
  }

  /**
   * Consolidate memories for an entity
   *
   * Scans all memories for the given entity and creates links between
   * related memories based on vector similarity.
   *
   * @param entityId - Entity ID to consolidate memories for
   * @param options - Consolidation options
   * @returns Consolidation result with statistics
   *
   * @public
   */
  async consolidateMemories(
    entityId: string,
    options: ConsolidateMemoriesOptions = {},
  ): Promise<ConsolidateMemoriesResult> {
    const startTime = Date.now();
    const {
      similarityThreshold = 0.7,
      maxLinksPerMemory = 5,
      bidirectional = true,
      skipIfEdgeCountAbove = 0,
      onProgress,
    } = options;

    try {
      // Get all memories for this entity
      const memories = await this.storage.getMemoriesByEntity(entityId);

      if (memories.length === 0) {
        return {
          success: true,
          memoriesProcessed: 0,
          linksCreated: 0,
          linkedMemories: [],
          durationMs: Date.now() - startTime,
        };
      }

      let totalLinksCreated = 0;
      const linkedMemories: Array<{ memoryId: string; newLinks: string[] }> = [];

      // Process each memory
      for (let i = 0; i < memories.length; i++) {
        const memory = memories[i];

        // Report progress
        if (onProgress) {
          onProgress({
            current: i + 1,
            total: memories.length,
            memoryId: memory.id,
            linksCreated: totalLinksCreated,
          });
        }

        // Skip if memory already has enough edges
        if (skipIfEdgeCountAbove > 0 && memory.outgoingEdges.length >= skipIfEdgeCountAbove) {
          continue;
        }

        // Skip if memory has no embedding
        if (!memory.embedding || memory.embedding.length === 0) {
          continue;
        }

        // Find similar memories using vector search
        const similarMemories = await this.findSimilarMemories(
          memory,
          memories,
          similarityThreshold,
          maxLinksPerMemory,
        );

        if (similarMemories.length === 0) {
          continue;
        }

        // Create links to similar memories
        const newLinks = await this.createLinks(memory, similarMemories, bidirectional);

        if (newLinks.length > 0) {
          totalLinksCreated += newLinks.length;
          linkedMemories.push({
            memoryId: memory.id,
            newLinks,
          });
        }
      }

      return {
        success: true,
        memoriesProcessed: memories.length,
        linksCreated: totalLinksCreated,
        linkedMemories,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      return {
        success: false,
        memoriesProcessed: 0,
        linksCreated: 0,
        linkedMemories: [],
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Find similar memories for a given memory
   *
   * @param sourceMemory - Memory to find similar memories for
   * @param allMemories - All memories to search through
   * @param threshold - Similarity threshold
   * @param maxResults - Maximum number of results
   * @returns Array of similar memories (excluding already linked ones)
   */
  private async findSimilarMemories(
    sourceMemory: Memory,
    allMemories: Memory[],
    threshold: number,
    maxResults: number,
  ): Promise<Memory[]> {
    if (!sourceMemory.embedding) {
      return [];
    }

    // Use vector search to find similar memories
    const searchResults = await this.storage.searchByQuery(
      sourceMemory.embedding,
      sourceMemory.entityId,
      maxResults + 1 + sourceMemory.outgoingEdges.length, // Extra to account for self and existing links
      SearchMode.AGGRESSIVE, // Use aggressive to get more candidates, then filter by threshold
    );

    // Filter results
    return searchResults
      .filter(memory => {
        // Exclude self
        if (memory.id === sourceMemory.id) {
          return false;
        }

        // Exclude already linked memories
        if (sourceMemory.outgoingEdges.includes(memory.id)) {
          return false;
        }

        // Check similarity threshold
        if (memory.similarity !== undefined && memory.similarity < threshold) {
          return false;
        }

        return true;
      })
      .slice(0, maxResults);
  }

  /**
   * Create links between source memory and target memories
   *
   * @param sourceMemory - Source memory to link from
   * @param targetMemories - Target memories to link to
   * @param bidirectional - Whether to create bidirectional links
   * @returns Array of newly linked memory IDs
   */
  private async createLinks(
    sourceMemory: Memory,
    targetMemories: Memory[],
    bidirectional: boolean,
  ): Promise<string[]> {
    const newLinks: string[] = [];

    for (const targetMemory of targetMemories) {
      // Add link from source to target
      const sourceEdges = [...sourceMemory.outgoingEdges];
      if (!sourceEdges.includes(targetMemory.id)) {
        sourceEdges.push(targetMemory.id);
        await this.storage.updateOutgoingEdges(sourceMemory.id, sourceEdges);
        sourceMemory.outgoingEdges = sourceEdges; // Update local copy
        newLinks.push(targetMemory.id);
      }

      // Add reverse link if bidirectional
      if (bidirectional) {
        const targetEdges = [...targetMemory.outgoingEdges];
        if (!targetEdges.includes(sourceMemory.id)) {
          targetEdges.push(sourceMemory.id);
          await this.storage.updateOutgoingEdges(targetMemory.id, targetEdges);
          targetMemory.outgoingEdges = targetEdges; // Update local copy
        }
      }
    }

    return newLinks;
  }
}

/**
 * Convenience function to consolidate memories
 *
 * Creates a MemoryConsolidator and runs consolidation for the given entity.
 *
 * @param storage - Memory storage instance
 * @param entityId - Entity ID to consolidate memories for
 * @param options - Consolidation options
 * @returns Consolidation result
 *
 * @public
 */
export async function consolidateMemories(
  storage: MemoryStorage,
  entityId: string,
  options: ConsolidateMemoriesOptions = {},
): Promise<ConsolidateMemoriesResult> {
  const consolidator = new MemoryConsolidator(storage);
  return consolidator.consolidateMemories(entityId, options);
}
