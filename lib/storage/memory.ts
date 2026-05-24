/**
 * Deterministic in-memory `ObjectStorage` implementation for tests.
 *
 * Stores each object as a `Buffer` plus its metadata in a `Map`, keyed by
 * storage key. Contents survive only for the lifetime of the returned
 * adapter, so each test gets a fresh instance.
 *
 * Spec references:
 * - tasks.md Task 5.5 ("inMemoryStorage(): a deterministic test double
 *   storing Map<key, Buffer + metadata>").
 * - design.md Testing Strategy ("Object storage integration with a local
 *   MinIO container... unit tests use the in-memory adapter").
 */

import {
  type ObjectStorage,
  type PutObjectOptions,
  assertPositiveExpiry,
  buildCdnUrl,
} from "./object-storage";

/**
 * Snapshot of a stored object as visible to tests.
 */
export interface InMemoryStoredObject {
  readonly body: Buffer;
  readonly contentType: string;
  readonly contentHash: string;
  readonly isPublic: boolean;
}

/**
 * Test-only extension of `ObjectStorage` exposing inspection helpers.
 *
 * Tests use `peek` to assert that bytes/metadata were persisted as expected
 * and `entries` to enumerate the full keyspace. Production code should
 * depend on `ObjectStorage` only.
 */
export interface InMemoryObjectStorage extends ObjectStorage {
  /** Return the stored object at `key`, or `undefined` when missing. */
  peek(key: string): InMemoryStoredObject | undefined;
  /** Return the number of stored objects. */
  size(): number;
  /** Return an iterable of `[key, snapshot]` tuples for assertions. */
  entries(): IterableIterator<[string, InMemoryStoredObject]>;
  /** Remove every stored object. */
  clear(): void;
}

/**
 * Configuration for `inMemoryStorage`. `cdnBaseUrl` defaults to a stable
 * placeholder so tests that do not care about URLs can call
 * `inMemoryStorage()` with no arguments.
 */
export interface InMemoryStorageConfig {
  /** Base URL used by `getObjectUrl`; defaults to `https://cdn.test`. */
  readonly cdnBaseUrl?: string;
}

const DEFAULT_CDN_BASE_URL = "https://cdn.test";

/**
 * Construct a fresh in-memory `ObjectStorage` adapter.
 *
 * Behavior:
 * - `putObject` stores a defensive copy of the bytes so the adapter is
 *   immune to caller mutation.
 * - `getObjectUrl` returns `<cdnBaseUrl>/<key>?v=<contentHash>` regardless
 *   of whether the key exists, mirroring the S3/CDN adapter.
 * - `deleteObject` is idempotent (no error when the key is absent).
 * - `getSignedUrl` returns a deterministic URL embedding the requested
 *   expiry so tests can assert on it without relying on wall-clock time.
 */
export function inMemoryStorage(config: InMemoryStorageConfig = {}): InMemoryObjectStorage {
  const cdnBaseUrl = config.cdnBaseUrl ?? DEFAULT_CDN_BASE_URL;
  const store = new Map<string, InMemoryStoredObject>();

  return {
    async putObject(key, body, opts) {
      assertNonEmptyKey(key);
      assertPutOpts(opts);
      // Defensive copy so subsequent mutation of `body` cannot leak in.
      const copy = Buffer.from(body);
      store.set(key, {
        body: copy,
        contentType: opts.contentType,
        contentHash: opts.contentHash,
        isPublic: opts.isPublic,
      });
    },

    getObjectUrl(key, contentHash) {
      assertNonEmptyKey(key);
      return buildCdnUrl(cdnBaseUrl, key, contentHash);
    },

    async deleteObject(key) {
      assertNonEmptyKey(key);
      store.delete(key);
    },

    async getSignedUrl(key, expiresInSec) {
      assertNonEmptyKey(key);
      assertPositiveExpiry(expiresInSec);
      // Deterministic, opaque URL. Tests can assert on the path and expiry
      // query parameter without depending on the underlying signer.
      const encodedKey = key
        .replace(/^\/+/u, "")
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      return `memory://signed/${encodedKey}?expires=${expiresInSec}`;
    },

    peek(key) {
      return store.get(key);
    },

    size() {
      return store.size;
    },

    entries() {
      return store.entries();
    },

    clear() {
      store.clear();
    },
  };
}

function assertNonEmptyKey(key: string): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("ObjectStorage: key must be a non-empty string");
  }
}

function assertPutOpts(opts: PutObjectOptions): void {
  if (!opts || typeof opts !== "object") {
    throw new Error("ObjectStorage.putObject: opts must be an object");
  }
  if (typeof opts.contentType !== "string" || opts.contentType.length === 0) {
    throw new Error("ObjectStorage.putObject: opts.contentType must be a non-empty string");
  }
  if (typeof opts.contentHash !== "string" || opts.contentHash.length === 0) {
    throw new Error("ObjectStorage.putObject: opts.contentHash must be a non-empty string");
  }
  if (typeof opts.isPublic !== "boolean") {
    throw new Error("ObjectStorage.putObject: opts.isPublic must be a boolean");
  }
}
