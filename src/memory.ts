/**
 * Memory Infrastructure Layer Initialization
 *
 * Main entry point for initializing and using the Memory Infrastructure Layer.
 * This module provides a simple API for Application Layer to initialize
 * and get a memory storage instance with automatic embedding generation.
 */

import type { AIModelAdapter } from './adapters/ai-adapter';
import type { MemoryStorageAdapter } from './adapters/database-adapter';
import type { StorageConfig } from './storage/storage-types';
import { createStorageAdapter } from './storage/adapter-factory';
import { isPostgresConfig } from './storage/storage-types';
import { MemoryStorage } from './memory/storage';
import { EmbeddingService } from './vector/embedding-service';
import { MemoryConnector, type MemoryConnectorConfig } from './memory/connector';

/**
 * Memory Infrastructure Layer initialization options
 *
 * @public
 */
export interface MemoryInitOptions {
  /** AI model adapter for embedding generation (optional) */
  aiAdapter?: AIModelAdapter;
}

/**
 * Memory Infrastructure Layer instance
 *
 * @public
 */
export class Memory {
  private storage: MemoryStorage | null = null;
  private config: StorageConfig | null = null;

  /**
   * Initializes the Memory Infrastructure Layer with the provided storage configuration
   *
   * @param config - Storage configuration
   * @param options - Initialization options (AI adapter for embedding generation)
   * @throws Error if initialization fails
   *
   * @public
   */
  async initialize(config: StorageConfig, options: MemoryInitOptions = {}): Promise<void> {
    this.config = config;
    const adapter = createStorageAdapter(config);

    // Initialize adapter-specific setup (e.g., database connection, table creation)
    if (isPostgresConfig(config)) {
      const postgresAdapter = adapter as any; // Type assertion needed for now
      if (typeof postgresAdapter.initialize === 'function') {
        await postgresAdapter.initialize();
      }
    }

    // Create embedding service if AI adapter is provided
    const embeddingService = options.aiAdapter
      ? new EmbeddingService(options.aiAdapter)
      : undefined;

    // Create high-level storage with automatic embedding generation
    this.storage = new MemoryStorage(adapter, embeddingService);

    // TODO: Add initialization for other storage types as they are implemented
  }

  /**
   * Gets the memory storage instance
   *
   * This provides a high-level API that automatically handles embedding generation.
   * Application Layer should use this instead of directly accessing the adapter.
   *
   * @returns Memory storage instance
   * @throws Error if Memory has not been initialized
   *
   * @public
   */
  getStorage(): MemoryStorage {
    if (!this.storage) {
      throw new Error(
        'Memory Infrastructure Layer has not been initialized. Call Memory.initialize() first.',
      );
    }
    return this.storage;
  }

  /**
   * Gets the storage adapter instance (low-level API)
   *
   * @deprecated Use getStorage() instead for automatic embedding generation
   * @returns Storage adapter instance
   * @throws Error if Memory has not been initialized
   *
   * @public
   */
  getAdapter(): MemoryStorageAdapter {
    if (!this.storage) {
      throw new Error(
        'Memory Infrastructure Layer has not been initialized. Call Memory.initialize() first.',
      );
    }
    return (this.storage as any).adapter;
  }

  /**
   * Creates a Memory Connector instance
   *
   * Memory Connector provides automatic memory management by connecting to
   * chatting manager and detecting context changes. It also supports manual
   * memory creation for application layer.
   *
   * @param config - Connector configuration
   * @returns Memory Connector instance
   * @throws Error if Memory has not been initialized
   *
   * @public
   */
  createConnector(config: MemoryConnectorConfig): MemoryConnector {
    if (!this.storage) {
      throw new Error(
        'Memory Infrastructure Layer has not been initialized. Call Memory.initialize() first.',
      );
    }
    return new MemoryConnector(this.storage, config);
  }

  /**
   * Closes connections and cleans up resources
   *
   * @public
   */
  async close(): Promise<void> {
    if (this.storage && isPostgresConfig(this.config!)) {
      const adapter = (this.storage as any).adapter;
      if (adapter && typeof adapter.close === 'function') {
        await adapter.close();
      }
    }
    this.storage = null;
    this.config = null;
  }
}

/**
 * Singleton instance for convenience
 * Application Layer can use this or create their own instance
 *
 * @public
 */
export const memory = new Memory();
