/**
 * @openaikits/memory - Memory Infrastructure Layer
 *
 * Vector/Graph based memory search and generation system.
 * This package provides a reusable memory infrastructure that can be used
 * across different projects.
 *
 * @packageDocumentation
 */

// Public API exports
export * from './types';

// Adapters
export * from './adapters/database-adapter';
export * from './adapters/ai-adapter';

// Storage types and initialization
export * from './storage/storage-types';
export * from './tuning';
export { Memory, memory } from './memory';
export { MemoryStorage } from './memory/storage';
export type { CreateMemoryOptions } from './memory/storage';

// Memory components
export { MemoryConnector } from './memory/connector';
export type {
  MemoryConnectorConfig,
  MemoryContext,
  ApplyOperationOutcome,
  ApplyOperationsResult,
  CreateMemoryOptions as ConnectorCreateMemoryOptions,
  ContextChangeCallback,
  ChattingManager,
} from './memory/connector';
export {
  runRankedRetrieval,
  effectiveStrength,
  DEMOTED_SCORE_FACTOR,
} from './memory/ranked-retrieval';
export type { RankedRetrievalResult } from './memory/ranked-retrieval';
export { runSleep, normalizeSleepConfig, DEFAULT_SLEEP_CONFIG } from './memory/sleep';
export type {
  SleepConfig,
  SleepRunOptions,
  SleepRunReason,
  SleepRunResult,
  SleepJobVerdict,
} from './memory/sleep';
export {
  buildWorkingSet,
  buildMemoryWriteInstructions,
  buildConversationTranscript,
  writeInstructionParts,
  DEFAULT_MEMORY_OPS_BLOCK_TAG,
  DEFAULT_MAX_OPERATIONS,
  parseMemoryOperations,
  stripMemoryOpsBlock,
} from './memory/write-contract';
export type {
  WorkingSet,
  WorkingSetEntry,
  WriteInstructionOptions,
  WriteInstructionParts,
  TranscriptMessage,
  TranscriptOptions,
  ParseDropReason,
  ParseMemoryOperationsResult,
} from './memory/write-contract';
export { planBulkCreate } from './memory/bulk-plan';
export { commitBulkPlan, MAX_PLANNED_NODES_PER_COMMIT } from './memory/bulk-commit';
export type { CommitBulkPlanOptions, CommitBulkPlanResult } from './memory/bulk-commit';
export type {
  BulkPlan,
  BulkPlanItem,
  BulkPlanOptions,
  BulkPlanNode,
  BulkPlanEdge,
  BulkPlanStats,
} from './memory/bulk-plan';

// Legacy Optimizer — kept only for the host's "Reflection" feature; removed with v1 cleanup
export {
  MemoryOptimizer,
  optimizeMemories,
  compressMemories,
  createMemoryShortcuts,
  cleanupMemoryLinks,
} from './memory/optimizer';
export type {
  CompressResult,
  ShortcutResult,
  CleanupResult,
  OptimizerMethodOptions,
} from './memory/optimizer';

// Vector components
export * from './vector/embedding-service';
export * from './vector/openai-adapter';
// export * from './vector/search-engine';

// Graph components will be exported here as they are implemented
// export * from './graph/relationship-engine';
// export * from './graph/traversal';
