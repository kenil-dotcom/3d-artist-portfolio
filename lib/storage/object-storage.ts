/**
 * Object storage interface for project media (originals, generated variants,
 * inquiry reference images, sitemap blobs, etc.).
 *
 * Two implementations are provided:
 *
 * - `s3Storage(config)` in `./s3.ts` — production adapter backed by the AWS
 *   SDK with SSE-S3 by default and SSE-KMS when `S3_KMS_KEY_ID` is configured.
 *   Private originals; public URLs go through the CDN with a `?v=...`
 *   content-hash cache buster.
 * - `inMemoryStorage()` in `./memory.ts` — deterministic test double storing
 *   bytes in a `Map`, used by unit/property tests so they never touch S3.
 *
 * Spec references:
 * - design.md "Technology choices" (S3-compatible storage with SSE-KMS).
 * - design.md caching/revalidation notes ("Image and video URLs embed a
 *   `contentHash` and are served Cache-Control: public, max-age=31536000,
 *   immutable").
 * - Requirements 8.3, 8.4, 12.3.
 *
 * IMPORTANT: importing this module must not throw, even if storage env
 * variables are unset. The S3 adapter validates configuration on its first
 * call so tests can substitute the in-memory adapter without setting env
 * vars. See `lib/config/env.ts`.
 */

/**
 * Options for `ObjectStorage.putObject`.
 *
 * - `contentType`: required so the CDN serves the right MIME type.
 * - `contentHash`: hex-encoded SHA-256 of `body`; embedded in the public URL
 *   as `?v=<hash>` so cached responses are immutable across content edits.
 * - `isPublic`: when `true`, the object should be served via the CDN as a
 *   public asset (e.g. derived image/video variants). Originals and inquiry
 *   reference images use `false` so they remain private and only reachable
 *   through `getSignedUrl`.
 */
export interface PutObjectOptions {
  readonly contentType: string;
  readonly contentHash: string;
  readonly isPublic: boolean;
}

/**
 * Storage-agnostic interface used by the media pipeline, CMS, and inquiry
 * subsystem.
 *
 * Implementations must:
 * - Encrypt private objects at rest (Requirement 12.3). The S3 adapter does
 *   so via SSE-S3 (AES-256) by default and SSE-KMS when configured.
 * - Return URLs from `getObjectUrl` that include the supplied content hash
 *   so cached entries are invalidated when content changes.
 * - Throw a descriptive `Error` on unknown keys, transient I/O failures,
 *   etc. — callers translate these into user-facing errors.
 */
export interface ObjectStorage {
  /**
   * Persist `body` at `key` with the given metadata. Overwrites any existing
   * object at the same key.
   *
   * @param key   Canonical storage key, e.g. `media/<projectId>/<id>.jpg`.
   * @param body  Raw bytes to store.
   * @param opts  Content type, content hash, and public/private flag.
   */
  putObject(key: string, body: Uint8Array, opts: PutObjectOptions): Promise<void>;

  /**
   * Return the public, CDN-fronted URL for an object stored at `key`.
   * The URL embeds `contentHash` as `?v=<hash>` so the CDN caches each
   * version forever and updates surface immediately.
   *
   * Implementations do not verify that the object actually exists; this is a
   * pure URL builder so it can be called from server components without
   * round-tripping to storage.
   */
  getObjectUrl(key: string, contentHash: string): string;

  /**
   * Permanently delete the object at `key`. Idempotent: deleting a missing
   * key resolves successfully so callers can retry safely.
   */
  deleteObject(key: string): Promise<void>;

  /**
   * Return a short-lived URL granting read access to a private object.
   *
   * @param key            Canonical storage key.
   * @param expiresInSec   Number of seconds the URL remains valid; must be
   *                       a positive finite integer.
   */
  getSignedUrl(key: string, expiresInSec: number): Promise<string>;
}

/**
 * Compose a CDN URL of the form `<cdnBaseUrl>/<key>?v=<contentHash>`.
 *
 * Centralised so the S3 and in-memory adapters produce byte-identical URLs
 * for the same `(cdnBaseUrl, key, contentHash)` triple, which keeps cache
 * keys stable across deployments and tests.
 *
 * The function:
 * - Strips trailing slashes from `cdnBaseUrl` and leading slashes from `key`
 *   so callers can pass either form without producing `//` collisions.
 * - URL-encodes path segments individually but preserves `/` so multi-level
 *   keys like `media/2024/abc.jpg` remain readable.
 * - Validates `contentHash` is non-empty so we never emit `?v=` URLs that
 *   would defeat the cache buster.
 *
 * @internal Exposed for unit tests and reuse by storage adapters.
 */
export function buildCdnUrl(
  cdnBaseUrl: string,
  key: string,
  contentHash: string,
): string {
  if (typeof cdnBaseUrl !== "string" || cdnBaseUrl.length === 0) {
    throw new Error("buildCdnUrl: cdnBaseUrl must be a non-empty string");
  }
  if (typeof key !== "string" || key.length === 0) {
    throw new Error("buildCdnUrl: key must be a non-empty string");
  }
  if (typeof contentHash !== "string" || contentHash.length === 0) {
    throw new Error("buildCdnUrl: contentHash must be a non-empty string");
  }

  const base = cdnBaseUrl.replace(/\/+$/u, "");
  const trimmedKey = key.replace(/^\/+/u, "");
  const encodedKey = trimmedKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${base}/${encodedKey}?v=${encodeURIComponent(contentHash)}`;
}

/**
 * Validate that `expiresInSec` is a positive finite integer. Used by both
 * adapters to fail fast with a consistent error message.
 *
 * @internal
 */
export function assertPositiveExpiry(expiresInSec: number): void {
  if (
    typeof expiresInSec !== "number" ||
    !Number.isFinite(expiresInSec) ||
    !Number.isInteger(expiresInSec) ||
    expiresInSec <= 0
  ) {
    throw new RangeError(
      `expiresInSec must be a positive integer number of seconds, got ${String(expiresInSec)}`,
    );
  }
}
