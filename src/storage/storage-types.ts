/**
 * Storage Type Definitions
 *
 * Defines the types of storage backends supported by the Memory Infrastructure Layer.
 * Currently supports PostgreSQL, with plans for file-based storage in the future.
 */

/**
 * Supported storage types
 *
 * @public
 */
export enum StorageType {
  /** PostgreSQL database (recommended for production) */
  POSTGRES = 'postgres',
  /** Text file storage (for development/testing) */
  TXT_FILE = 'txt_file',
}

/**
 * Base configuration for storage adapters
 *
 * @public
 */
export interface BaseStorageConfig {
  /** Storage type */
  type: StorageType;
}

/**
 * PostgreSQL storage configuration
 *
 * @public
 */
export interface PostgresStorageConfig extends BaseStorageConfig {
  type: StorageType.POSTGRES;
  /** PostgreSQL connection string (e.g., postgresql://user:password@host:port/database) */
  connectionString: string;
  /** Schema name (default: 'public') */
  schema?: string;
  /** Whether to run migrations automatically on initialization */
  autoMigrate?: boolean;
  /** Path to migration files directory (relative to package root) */
  migrationsPath?: string;
}

/**
 * Text file storage configuration
 *
 * @public
 */
export interface TxtFileStorageConfig extends BaseStorageConfig {
  type: StorageType.TXT_FILE;
  /** Path to the directory where memory files will be stored */
  directory: string;
}

/**
 * Union type of all storage configurations
 *
 * @public
 */
export type StorageConfig = PostgresStorageConfig | TxtFileStorageConfig;

/**
 * Type guard to check if config is PostgresStorageConfig
 *
 * @public
 */
export function isPostgresConfig(config: StorageConfig): config is PostgresStorageConfig {
  return config.type === StorageType.POSTGRES;
}

/**
 * Type guard to check if config is TxtFileStorageConfig
 *
 * @public
 */
export function isTxtFileConfig(config: StorageConfig): config is TxtFileStorageConfig {
  return config.type === StorageType.TXT_FILE;
}
