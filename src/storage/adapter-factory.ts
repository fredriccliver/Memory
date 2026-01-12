/**
 * Storage Adapter Factory
 *
 * Creates appropriate storage adapter instances based on storage configuration.
 * This factory pattern allows the Memory Infrastructure Layer to support multiple
 * storage backends while keeping the implementation details abstracted.
 */

import type { MemoryStorageAdapter } from '../adapters/database-adapter';
import type { StorageConfig } from './storage-types';
import { StorageType, isPostgresConfig } from './storage-types';
import { PostgresAdapter } from './adapters/postgres-adapter';

/**
 * Creates a storage adapter based on the provided configuration
 *
 * @param config - Storage configuration
 * @returns Storage adapter instance
 * @throws Error if storage type is not supported
 *
 * @public
 */
export function createStorageAdapter(config: StorageConfig): MemoryStorageAdapter {
  switch (config.type) {
    case StorageType.POSTGRES:
      if (!isPostgresConfig(config)) {
        throw new Error('Invalid PostgreSQL configuration');
      }
      return new PostgresAdapter(config);

    case StorageType.TXT_FILE:
      throw new Error('TXT_FILE storage is not yet implemented');

    default:
      throw new Error(`Unsupported storage type: ${(config as StorageConfig).type}`);
  }
}
