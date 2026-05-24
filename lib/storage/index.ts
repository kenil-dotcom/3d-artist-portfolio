/**
 * Barrel re-export for the object storage module.
 *
 * Importers should prefer `@/lib/storage` over the individual file paths so
 * the public surface stays cohesive.
 */

export {
  type ObjectStorage,
  type PutObjectOptions,
  buildCdnUrl,
} from "./object-storage";
export { s3Storage, type S3StorageConfig } from "./s3";
export {
  inMemoryStorage,
  type InMemoryObjectStorage,
  type InMemoryStorageConfig,
  type InMemoryStoredObject,
} from "./memory";
