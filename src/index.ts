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
export { Memory, memory } from './memory';
export { MemoryStorage } from './memory/storage';
export type { CreateMemoryOptions } from './memory/storage';

// Memory components
export { MemoryConnector } from './memory/connector';
export type {
  MemoryConnectorConfig,
  MemoryContext,
  CreateMemoryOptions as ConnectorCreateMemoryOptions,
  ContextChangeCallback,
  ChattingManager,
} from './memory/connector';
export { DynamicMemoryGenerator } from './memory/generator';
export type { CollectAugmentationOptions } from './memory/generator';
export { MemoryToolHandler } from './memory/tool-handler';
export type {
  CreateMemoryParams,
  UpdateMemoryParams,
  UpdateMemoryLinkParams,
  DeleteMemoryParams,
  ToolHandlerResult,
} from './memory/tool-handler';

// Vector components
export * from './vector/embedding-service';
export * from './vector/openai-adapter';
// export * from './vector/search-engine';

// Graph components will be exported here as they are implemented
// export * from './graph/relationship-engine';
// export * from './graph/traversal';

// Tools will be exported here as they are implemented
// export * from './tools/ai-tools';
