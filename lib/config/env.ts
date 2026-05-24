/**
 * Typed environment variable helpers.
 *
 * Reading is deliberately lazy: importing this module never inspects
 * `process.env`, so unit tests and the in-memory storage adapter can
 * substitute fakes without setting any S3/CDN environment variables. The
 * first call into a getter (e.g. `getStorageEnv()`) is what validates and
 * throws on missing configuration.
 *
 * Spec references:
 * - design.md "Technology choices" / "Database schema notes" (object storage
 *   uses S3-compatible service with SSE-S3 or SSE-KMS).
 * - tasks.md Task 5.5 ("Wire env vars from .env.example").
 */

/**
 * Resolved storage configuration as read from `process.env`.
 *
 * `s3KmsKeyId` is `null` when SSE-S3 (AES-256) should be used in lieu of
 * SSE-KMS. `s3AccessKeyId` and `s3SecretAccessKey` are also nullable because
 * the AWS SDK can resolve credentials from the ambient environment, IAM
 * roles, or instance metadata when they are not supplied explicitly.
 */
export interface StorageEnv {
  readonly s3Region: string;
  readonly s3Bucket: string;
  readonly s3AccessKeyId: string | null;
  readonly s3SecretAccessKey: string | null;
  readonly s3KmsKeyId: string | null;
  readonly cdnBaseUrl: string;
}

/**
 * Internal helper: read a non-empty string from `process.env`, or `null` when
 * absent or set to an empty string.
 */
function readOptional(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Internal helper: read a required, non-empty string from `process.env`,
 * throwing a descriptive error when missing. The error names every variable
 * involved in storage configuration so misconfiguration is easy to diagnose
 * from a single message.
 */
function readRequired(name: string): string {
  const value = readOptional(name);
  if (value === null) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Object storage requires S3_REGION, S3_BUCKET, and CDN_BASE_URL ` +
        `to be set. See .env.example for the full list.`,
    );
  }
  return value;
}

/**
 * Return the validated `StorageEnv` for the current process.
 *
 * Throws on first call when required variables are missing or when
 * `CDN_BASE_URL` is not a syntactically valid absolute URL. The result is
 * not cached so tests that mutate `process.env` see fresh values.
 */
export function getStorageEnv(): StorageEnv {
  const s3Region = readRequired("S3_REGION");
  const s3Bucket = readRequired("S3_BUCKET");
  const cdnBaseUrl = readRequired("CDN_BASE_URL");

  // Validate cdnBaseUrl is a syntactically valid absolute URL so we never
  // produce malformed media URLs. We do not require https here so local
  // development can use http://localhost values; production should be https.
  try {
    // eslint-disable-next-line no-new
    new URL(cdnBaseUrl);
  } catch {
    throw new Error(
      `CDN_BASE_URL must be an absolute URL (got: ${JSON.stringify(cdnBaseUrl)}).`,
    );
  }

  return {
    s3Region,
    s3Bucket,
    s3AccessKeyId: readOptional("S3_ACCESS_KEY_ID"),
    s3SecretAccessKey: readOptional("S3_SECRET_ACCESS_KEY"),
    s3KmsKeyId: readOptional("S3_KMS_KEY_ID"),
    cdnBaseUrl,
  };
}
