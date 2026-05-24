/**
 * Production `ObjectStorage` adapter backed by AWS S3 (or any S3-compatible
 * service such as Cloudflare R2 or MinIO).
 *
 * Encryption at rest is enforced server-side: SSE-S3 (AES-256) by default,
 * upgrading to SSE-KMS when `S3_KMS_KEY_ID` is set so backups remain
 * unreadable without the configured key (Requirement 12.3, design "Database
 * schema notes"). Originals are written with `private` ACL semantics — the
 * S3 SDK does not send an explicit ACL, relying on the bucket's default
 * deny-public policy — and are reachable only via short-lived presigned
 * URLs. Public derived variants are still served through the CDN using
 * `getObjectUrl`.
 *
 * Module-load behavior: this file imports the AWS SDK eagerly but does not
 * read any environment variables or construct an `S3Client` until the
 * factory `s3Storage(config)` is invoked or one of the returned methods is
 * called for the first time. Tests that substitute `inMemoryStorage()` can
 * therefore import this file freely without provisioning AWS credentials.
 *
 * Spec references:
 * - design.md "Technology choices" (S3 with SSE-KMS).
 * - design.md "Caching and revalidation" (immutable URLs with content hash).
 * - Requirements 8.3, 8.4, 12.3.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getStorageEnv, type StorageEnv } from "@/lib/config/env";
import {
  type ObjectStorage,
  type PutObjectOptions,
  assertPositiveExpiry,
  buildCdnUrl,
} from "./object-storage";

/**
 * Optional configuration overrides for `s3Storage`.
 *
 * When omitted, every value is read from `process.env` via `getStorageEnv`
 * on the first storage call (not at construction time, so importing this
 * module never throws when env vars are unset).
 */
export interface S3StorageConfig {
  /** AWS region; defaults to `S3_REGION`. */
  readonly region?: string;
  /** Bucket to read/write; defaults to `S3_BUCKET`. */
  readonly bucket?: string;
  /** Optional access key id; defaults to `S3_ACCESS_KEY_ID` or SDK chain. */
  readonly accessKeyId?: string | null;
  /** Optional secret access key; defaults to `S3_SECRET_ACCESS_KEY` or SDK chain. */
  readonly secretAccessKey?: string | null;
  /** KMS key id; when set, objects are stored with SSE-KMS instead of SSE-S3. */
  readonly kmsKeyId?: string | null;
  /**
   * Custom S3-compatible endpoint URL. Required for Cloudflare R2 (looks
   * like `https://<account>.r2.cloudflarestorage.com`); leave undefined for
   * AWS S3 to use the default region-derived endpoint.
   */
  readonly endpoint?: string | null;
  /** CDN base URL used by `getObjectUrl`; defaults to `CDN_BASE_URL`. */
  readonly cdnBaseUrl?: string;
  /**
   * Pre-built `S3Client` (mostly for tests/local MinIO). When supplied,
   * region/access keys on this config are ignored.
   */
  readonly client?: S3Client;
}

/**
 * Construct a production `ObjectStorage` adapter.
 *
 * The returned object captures `config` but defers reading `process.env`
 * until the first call. This means:
 * - `import { s3Storage } from "@/lib/storage/s3"` is side-effect-free.
 * - Tests that wire in `inMemoryStorage()` never trigger env validation.
 * - The first `putObject`/`getSignedUrl`/etc. throws a descriptive error
 *   when required variables (`S3_REGION`, `S3_BUCKET`, `CDN_BASE_URL`) are
 *   missing.
 */
export function s3Storage(config: S3StorageConfig = {}): ObjectStorage {
  // Lazy resolver caches the resolved configuration after the first call.
  let resolved:
    | {
        client: S3Client;
        bucket: string;
        cdnBaseUrl: string;
        kmsKeyId: string | null;
      }
    | null = null;

  function resolve(): {
    client: S3Client;
    bucket: string;
    cdnBaseUrl: string;
    kmsKeyId: string | null;
  } {
    if (resolved !== null) return resolved;

    // Pull anything not provided in `config` from the environment. We only
    // touch `process.env` here, not at module import, so unrelated tests
    // can run without S3 env vars.
    const env: Partial<StorageEnv> =
      // Skip env lookup entirely when every value the env supplies has
      // already been provided via `config`. Useful for tests that pass
      // their own client + bucket + cdnBaseUrl.
      config.region !== undefined &&
      config.bucket !== undefined &&
      config.cdnBaseUrl !== undefined &&
      config.client !== undefined
        ? {}
        : getStorageEnv();

    const region = config.region ?? env.s3Region;
    const bucket = config.bucket ?? env.s3Bucket;
    const cdnBaseUrl = config.cdnBaseUrl ?? env.cdnBaseUrl;
    const accessKeyId =
      config.accessKeyId !== undefined ? config.accessKeyId : (env.s3AccessKeyId ?? null);
    const secretAccessKey =
      config.secretAccessKey !== undefined
        ? config.secretAccessKey
        : (env.s3SecretAccessKey ?? null);
    const kmsKeyId = config.kmsKeyId !== undefined ? config.kmsKeyId : (env.s3KmsKeyId ?? null);
    const endpoint =
      config.endpoint !== undefined ? config.endpoint : (env.s3Endpoint ?? null);

    if (!region) {
      throw new Error("s3Storage: region is required (set S3_REGION or pass config.region)");
    }
    if (!bucket) {
      throw new Error("s3Storage: bucket is required (set S3_BUCKET or pass config.bucket)");
    }
    if (!cdnBaseUrl) {
      throw new Error(
        "s3Storage: cdnBaseUrl is required (set CDN_BASE_URL or pass config.cdnBaseUrl)",
      );
    }

    const client =
      config.client ??
      new S3Client(buildClientConfig(region, accessKeyId, secretAccessKey, endpoint));

    resolved = { client, bucket, cdnBaseUrl, kmsKeyId };
    return resolved;
  }

  return {
    async putObject(key, body, opts) {
      assertNonEmptyKey(key);
      assertPutOpts(opts);
      const { client, bucket, kmsKeyId } = resolve();

      // Choose SSE-KMS when a key is configured; otherwise fall back to
      // SSE-S3 (AES-256). Both satisfy the "encrypted at rest" requirement
      // (Requirement 12.3) — KMS just adds key-level access control.
      const sse = buildEncryptionParams(kmsKeyId);

      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: opts.contentType,
          // Embed the content hash as object metadata so audits and the
          // media pipeline can verify the stored bytes match the URL hash.
          Metadata: { "content-hash": opts.contentHash },
          // Originals (private) and public-derived variants share the same
          // bucket; the bucket policy forbids public reads, and `isPublic`
          // is informational here. Public delivery happens via the CDN
          // using `getObjectUrl`.
          ...sse,
        }),
      );
    },

    getObjectUrl(key, contentHash) {
      assertNonEmptyKey(key);
      const { cdnBaseUrl } = resolve();
      return buildCdnUrl(cdnBaseUrl, key, contentHash);
    },

    async deleteObject(key) {
      assertNonEmptyKey(key);
      const { client, bucket } = resolve();
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    async getSignedUrl(key, expiresInSec) {
      assertNonEmptyKey(key);
      assertPositiveExpiry(expiresInSec);
      const { client, bucket } = resolve();
      const command = new GetObjectCommand({ Bucket: bucket, Key: key });
      return awsGetSignedUrl(client, command, { expiresIn: expiresInSec });
    },
  };
}

/**
 * Build the SDK client configuration. Explicit credentials are forwarded
 * when present; otherwise the SDK falls back to its default credential
 * provider chain (env vars, shared config files, IAM roles, etc.).
 *
 * `endpoint` is forwarded for S3-compatible services (Cloudflare R2,
 * MinIO) which expose a custom URL distinct from the AWS-region-derived
 * default. R2 also requires `forcePathStyle: true` because virtual-hosted
 * style URLs are not supported on its `r2.cloudflarestorage.com` host.
 */
function buildClientConfig(
  region: string,
  accessKeyId: string | null,
  secretAccessKey: string | null,
  endpoint: string | null,
): S3ClientConfig {
  const cfg: S3ClientConfig = { region };
  if (accessKeyId && secretAccessKey) {
    cfg.credentials = { accessKeyId, secretAccessKey };
  }
  if (endpoint && endpoint.length > 0) {
    cfg.endpoint = endpoint;
    cfg.forcePathStyle = true;
  }
  return cfg;
}

/**
 * Translate `kmsKeyId` into the matching `PutObjectCommand` parameters.
 *
 * - Non-null key: SSE-KMS with the supplied CMK.
 * - Null/empty key: SSE-S3 with AES-256 managed by S3.
 */
function buildEncryptionParams(
  kmsKeyId: string | null,
): Pick<
  ConstructorParameters<typeof PutObjectCommand>[0],
  "ServerSideEncryption" | "SSEKMSKeyId"
> {
  if (kmsKeyId && kmsKeyId.length > 0) {
    return { ServerSideEncryption: "aws:kms", SSEKMSKeyId: kmsKeyId };
  }
  return { ServerSideEncryption: "AES256" };
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
