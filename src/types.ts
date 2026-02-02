/**
 * Common type definitions for @openaikits/memory
 */

/**
 * Search mode for vector similarity search
 *
 * Determines how aggressively to search for similar memories.
 * Lower thresholds return more results (broader search), higher thresholds return fewer but more relevant results (precise search).
 *
 * @public
 */
export enum SearchMode {
  /** Aggressive search: threshold 0.2 - Returns more results, useful for exploratory searches */
  AGGRESSIVE = 0.2,
  /** Normal search: threshold 0.5 - Balanced between recall and precision */
  NORMAL = 0.5,
  /** Conservative search: threshold 0.7 - Returns fewer but more relevant results (default) */
  CONSERVATIVE = 0.7,
}

/**
 * Get threshold value from SearchMode
 *
 * @param mode - Search mode
 * @returns Threshold value (0-1)
 *
 * @public
 */
export function getThresholdFromMode(mode: SearchMode): number {
  return mode;
}

/**
 * Memory node representing a piece of information
 *
 * Memory is stored as a Node; `outgoingEdges` form a graph. There is no separate
 * Relationship entity—each node holds its own connection info.
 */
export interface Memory {
  /** Unique identifier for the memory (UUID, not table index) */
  id: string;
  /** Content of the memory (natural language text) */
  content: string;
  /** ID of the entity this memory belongs to (TEXT, not UUID - e.g., persona ID, user ID, etc.) */
  entityId: string;
  /** Embedding vector for similarity search */
  embedding?: number[];
  /** Outgoing edges to related memories (graph structure) - Array of Memory UUIDs */
  outgoingEdges: string[];
  /** Similarity score (0-1) when returned from vector search */
  similarity?: number;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Augmentation data for memory generation
 */
export interface AugmentationData {
  /** Vector search results */
  vectorMemories: Memory[];
  /** Graph traversal results (found by following outgoingEdges) */
  graphMemories: Memory[];
}

/**
 * Validation result for memory consistency
 */
export interface ValidationResult {
  /** Whether the memory is valid */
  isValid: boolean;
  /** Validation errors if any */
  errors?: string[];
  /** Warnings if any */
  warnings?: string[];
}

/**
 * Conversation context for memory generation
 *
 * Application layer passes this as-is; the memory layer decides how much to use (slicing, etc.).
 */
export interface ConversationContext {
  /** Current conversation messages */
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  /** Current entity ID (e.g., persona, user, etc.) */
  entityId: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Single memory operation (create | update | updateLink | delete)
 *
 * @public
 */
export type MemoryOperation =
  | { action: 'create'; content: string; relatedMemoryIds?: string[] }
  | { action: 'update'; memoryId: string; content: string }
  | { action: 'updateLink'; fromMemoryId: string; toMemoryId: string; linkAction: 'add' | 'remove' }
  | { action: 'delete'; memoryId: string };

/**
 * Adapter for LLM completion used by the connector to obtain memory operations from context.
 * Application provides this; the package owns prompt construction and parsing.
 *
 * @public
 */
export interface AfterResponseContextAdapter {
  /** Generate completion from messages (e.g. system + user). Returns raw string (JSON). */
  generate(messages: Array<{ role: string; content: string }>): Promise<string>;
}
