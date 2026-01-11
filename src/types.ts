/**
 * Common type definitions for @openaikits/memory
 */

/**
 * Memory node representing a piece of information
 */
export interface Memory {
  /** Unique identifier for the memory */
  id: string;
  /** Content of the memory (natural language text) */
  content: string;
  /** ID of the persona/entity this memory belongs to */
  personaId: string;
  /** Embedding vector for similarity search */
  embedding?: number[];
  /** Outgoing edges to related memories (graph structure) */
  outgoingEdges: string[];
  /** Metadata for the memory */
  metadata?: Record<string, unknown>;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
}

/**
 * Relationship between memories
 */
export interface Relationship {
  /** Source memory ID */
  from: string;
  /** Target memory ID */
  to: string;
  /** Relationship type (optional, for future use) */
  type?: string;
}

/**
 * Augmentation data for memory generation
 */
export interface AugmentationData {
  /** Vector search results */
  vectorMemories: Memory[];
  /** Graph traversal results */
  graphMemories: Memory[];
  /** Existing relationships */
  relationships: Relationship[];
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
 */
export interface ConversationContext {
  /** Current conversation messages */
  messages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  /** Current persona ID */
  personaId: string;
  /** Additional context */
  metadata?: Record<string, unknown>;
}
