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
  /** Node's own strength 0-1 (usage-carved; decayed lazily at read time) */
  strength?: number;
  /** Last time strength was updated (bump/decay anchor) */
  strengthUpdatedAt?: Date;
  /** Number of times this memory was retrieved */
  retrievalCount?: number;
  /** Last time this memory was retrieved */
  lastRetrievedAt?: Date | null;
  /** Node status: 'active' | 'demoted' */
  status?: string;
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

// ============================================================================
// Optimizer types
// ============================================================================

/**
 * Single optimizer operation returned by LLM
 *
 * @public
 */
export type OptimizerOperation =
  | {
      action: 'compress';
      sourceMemoryIds: string[];
      compressedContent: string;
      linkTo?: string[];
    }
  | { action: 'addEdge'; fromMemoryId: string; toMemoryId: string }
  | { action: 'removeEdge'; fromMemoryId: string; toMemoryId: string };

/**
 * Edge traversal statistics for a single edge
 *
 * @public
 */
export interface EdgeTraversalStat {
  /** Source memory UUID */
  fromMemoryId: string;
  /** Target memory UUID */
  toMemoryId: string;
  /** Number of times this edge was traversed */
  traversalCount: number;
  /** Last time this edge was traversed */
  lastTraversedAt: Date;
}

/**
 * Origin of a memory edge — how the relationship hypothesis was created
 *
 * - `conversation`: linked by the after-response LLM during chat
 * - `knn_seed`: seeded from embedding nearest-neighbor lookup (hypothesis)
 * - `sleep`: created/confirmed by the background sleep worker
 * - `import`: created during bulk import
 * - `legacy`: backfilled from the legacy outgoing_edges array
 *
 * @public
 */
export type MemoryEdgeOrigin = 'conversation' | 'knn_seed' | 'sleep' | 'import' | 'legacy';

/**
 * A first-class edge between two memories
 *
 * Edges are hypotheses: they enter cheap, usage strengthens them and disuse
 * decays them (effective strength is computed lazily at read time).
 *
 * @public
 */
export interface MemoryEdge {
  /** Edge UUID */
  id: string;
  /** Entity both memories belong to */
  entityId: string;
  /** Source memory UUID */
  fromId: string;
  /** Target memory UUID */
  toId: string;
  /** Edge type: 'related' (undirected meaning) | 'summary_of' | 'supersedes' | extensible */
  type: string;
  /** How this edge was created */
  origin: MemoryEdgeOrigin;
  /** Stored strength (0-1). Effective strength = strength decayed since strengthUpdatedAt */
  strength: number;
  /** Creation time */
  createdAt: Date;
  /** Last time strength was updated (bump/decay anchor) */
  strengthUpdatedAt: Date;
}

/**
 * Input for inserting a memory edge
 *
 * @public
 */
export interface MemoryEdgeInsert {
  /** Entity both memories belong to */
  entityId: string;
  /** Source memory UUID */
  fromId: string;
  /** Target memory UUID */
  toId: string;
  /** Edge type (default: 'related') */
  type?: string;
  /** How this edge was created */
  origin: MemoryEdgeOrigin;
  /** Initial strength 0-1 (default: 0.5) */
  strength?: number;
}

/**
 * A retrieval shadow comparison record (legacy vs ranked results)
 *
 * @public
 */
export interface RetrievalShadowRecord {
  /** Entity the retrieval belongs to */
  entityId: string;
  /** Query text used for retrieval */
  query: string;
  /** Memory UUIDs returned by the legacy path */
  legacyIds: string[];
  /** Memory UUIDs returned by the ranked path */
  rankedIds: string[];
  /** Number of UUIDs present in both results */
  overlap: number;
}

/**
 * Input for enqueuing a sleep worker job
 *
 * @public
 */
export interface SleepJobInsert {
  /** Entity the job belongs to */
  entityId: string;
  /** Job kind: 'merge_review' | extensible */
  kind: string;
  /** Job payload (kind-specific) */
  payload: Record<string, unknown>;
}

/**
 * Outcome of a dedup gate decision
 *
 * - `created`: memory was created (no near-duplicate above threshold)
 * - `would_skip`: near-duplicate found in shadow mode — logged only, memory still created
 * - `skipped`: near-duplicate found in active mode — creation skipped
 *
 * @public
 */
export type GateDecision = 'created' | 'would_skip' | 'skipped';

/**
 * A dedup gate decision record for audit and threshold calibration
 *
 * @public
 */
export interface GateDecisionRecord {
  /** Entity the candidate memory belongs to */
  entityId: string;
  /** Gate mode in effect at decision time ('shadow' | 'active') */
  mode: 'shadow' | 'active';
  /** Decision outcome */
  decision: GateDecision;
  /** Similarity to the nearest existing memory (null when entity has no comparable memory) */
  similarity: number | null;
  /** UUID of the nearest existing memory (null when none) */
  matchedMemoryId: string | null;
  /** UUID of the created memory (null when creation was skipped) */
  newMemoryId: string | null;
  /** Content of the candidate memory (kept for audit of skipped creations) */
  candidateContent: string;
  /** Dedup skip threshold in effect at decision time */
  threshold: number;
}

/**
 * Options for running memory optimization
 *
 * @public
 */
export interface OptimizationOptions {
  /** Which strategy to run ('all' | 'compress' | 'shortcut' | 'cleanup') */
  scope?: 'all' | 'compress' | 'shortcut' | 'cleanup';
  /** Maximum memories per LLM call (default: 50) */
  batchSize?: number;
  /** LLM adapter for generating optimization decisions (required) */
  contextAdapter: AfterResponseContextAdapter;
  /** Enable verbose logging (default: false) */
  verbose?: boolean;
}

/**
 * Result of running memory optimization
 *
 * @public
 */
export interface OptimizationResult {
  /** Number of compressed nodes created */
  compressedNodesCreated: number;
  /** Number of shortcut edges added */
  shortcutsCreated: number;
  /** Number of edges removed */
  linksRemoved: number;
  /** Total execution time in milliseconds */
  durationMs: number;
}
