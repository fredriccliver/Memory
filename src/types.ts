/**
 * Common type definitions for @openaikits/memory
 */

/**
 * Memory node representing a piece of information
 *
 * Memory는 Node로 저장되며, `outgoingEdges` 배열을 통해 Graph 구조를 형성합니다.
 * 별도의 Relationship 엔티티 없이 Node 자체에 연결 정보를 포함합니다.
 */
export interface Memory {
  /** Unique identifier for the memory */
  id: string;
  /** Content of the memory (natural language text) */
  content: string;
  /** ID of the entity this memory belongs to (e.g., persona, user, etc.) */
  entityId: string;
  /** Embedding vector for similarity search */
  embedding?: number[];
  /** Outgoing edges to related memories (graph structure) - Array of memory IDs */
  outgoingEdges: string[];
  /** Metadata for the memory */
  metadata?: Record<string, unknown>;
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
