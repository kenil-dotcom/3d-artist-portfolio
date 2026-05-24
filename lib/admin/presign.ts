/**
 * Presigned PUT URL generator for direct-to-R2 uploads.
 *
 * The browser uploads media directly to the bucket using a short-lived
 * presigned URL, bypassing the Vercel function bandwidth limit and
 * supporting files up to the 5 GB validator ceiling. Only metadata
 * (filename, content-type, size) is sent through Next.js server actions;
 * bytes go straight from the browser to R2.
 *
 * This module is server-only and reads the same env vars as
 * `lib/admin/uploads.ts` so the two paths stay in sync.
 */

import 'server-only';

import { randomBytes } from 'node:crypto';

import {
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  ALLOWED_MIME_TYPES_BY_KIND,
  MAX_MEDIA_BYTES,
} from '@/lib/validation/media';
import type { MediaKind, MediaMimeType } from '@/lib/types/domain';

/** 15 minute presigned URL expiry. */
export const PRESIGN_EXPIRES_IN_SEC = 60 * 15;

export interface PresignedUpload {
  /** Short-lived presigned PUT URL for the browser to upload to. */
  readonly uploadUrl: string;
  /** Public URL the asset will be served from once uploaded. */
  readonly publicUrl: string;
  /** R2 object key (path inside the bucket). */
  readonly key: string;
  /** Seconds until the presigned URL expires. */
  readonly expiresIn: number;
  /** Inferred MediaKind from the validated content type. */
  readonly kind: MediaKind;
}

export type PresignResult =
  | { readonly ok: true; readonly value: PresignedUpload }
  | { readonly ok: false; readonly error: string };

/** Build the slugified filename used in object keys. */
export function slugifyFilename(filename: string): string {
  const trimmed = filename.trim();
  if (trimmed.length === 0) return 'file';
  // Strip the extension off, slugify the basename, then re-attach a
  // sanitised extension so the R2 key still reflects the file type.
  const lastDot = trimmed.lastIndexOf('.');
  const base = lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
  const ext = lastDot > 0 ? trimmed.slice(lastDot + 1) : '';
  const safeBase = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  const safeExt = ext
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '')
    .slice(0, 10);
  const finalBase = safeBase.length === 0 ? 'file' : safeBase;
  return safeExt.length === 0 ? finalBase : `${finalBase}.${safeExt}`;
}

/** 12-character URL-safe nonce used to keep R2 keys unique. */
function shortNonce(): string {
  // 9 random bytes → 12 base64url characters with no padding.
  return randomBytes(9)
    .toString('base64')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '')
    .slice(0, 12);
}

/** Map a validated MediaMimeType to its MediaKind. */
export function inferKindFromMime(mimeType: string): MediaKind | null {
  if (
    (ALLOWED_MIME_TYPES_BY_KIND.image as ReadonlyArray<string>).includes(mimeType)
  ) {
    return 'image';
  }
  if (
    (ALLOWED_MIME_TYPES_BY_KIND.video as ReadonlyArray<string>).includes(mimeType)
  ) {
    return 'video';
  }
  if (
    (ALLOWED_MIME_TYPES_BY_KIND.model3d as ReadonlyArray<string>).includes(
      mimeType,
    )
  ) {
    return 'model3d';
  }
  return null;
}

interface R2Config {
  readonly client: S3Client;
  readonly bucket: string;
  readonly publicBaseUrl: string;
}

let cachedR2: R2Config | null = null;

/**
 * Resolve the R2 client. Returns `null` when any of the required env vars
 * is missing so the caller can fail fast with a clear error.
 */
function resolveR2(): R2Config | null {
  if (cachedR2 !== null) return cachedR2;

  const region = (process.env.S3_REGION ?? '').trim();
  const bucket = (process.env.S3_BUCKET ?? '').trim();
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID ?? '').trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY ?? '').trim();
  const endpoint = (process.env.S3_ENDPOINT ?? '').trim();
  const publicBaseUrl = (process.env.CDN_BASE_URL ?? '').trim();

  if (
    region.length === 0 ||
    bucket.length === 0 ||
    accessKeyId.length === 0 ||
    secretAccessKey.length === 0 ||
    endpoint.length === 0 ||
    publicBaseUrl.length === 0
  ) {
    return null;
  }

  const cfg: S3ClientConfig = {
    region,
    endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
  };

  cachedR2 = {
    client: new S3Client(cfg),
    bucket,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/u, ''),
  };
  return cachedR2;
}

function buildPublicUrl(cfg: R2Config, key: string): string {
  return `${cfg.publicBaseUrl}/${key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

/**
 * Issue a presigned PUT URL for an admin-initiated upload. Validates the
 * content type against the media validator's allow-list and the size
 * against the 5 GB cap before contacting R2.
 *
 * @param projectId   Owning project id; embedded in the R2 key.
 * @param filename    Original filename from the file picker.
 * @param contentType Reported MIME type (already lowercased by the caller).
 * @param contentLength File size in bytes from `File.size`.
 */
export async function createPresignedUploadUrl(
  projectId: string,
  filename: string,
  contentType: string,
  contentLength: number,
): Promise<PresignResult> {
  const mime = contentType.trim().toLowerCase();
  const kind = inferKindFromMime(mime);
  if (kind === null) {
    return {
      ok: false,
      error: `Unsupported format "${mime}". Allowed: images (JPEG/PNG/WebP), videos (MP4/WebM), models (glTF/GLB).`,
    };
  }

  if (
    !Number.isFinite(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_MEDIA_BYTES
  ) {
    return {
      ok: false,
      error: `File size ${contentLength} bytes is outside the allowed range (1 byte to 5 GB).`,
    };
  }

  const r2 = resolveR2();
  if (r2 === null) {
    return {
      ok: false,
      error:
        'R2 credentials are not configured on the server (missing S3_* env vars).',
    };
  }

  const safeFilename = slugifyFilename(filename);
  const key = `media/${projectId}/${shortNonce()}-${safeFilename}`;

  try {
    const command = new PutObjectCommand({
      Bucket: r2.bucket,
      Key: key,
      ContentType: mime as MediaMimeType,
      ContentLength: contentLength,
      CacheControl: 'public, max-age=31536000, immutable',
    });
    const uploadUrl = await getSignedUrl(r2.client, command, {
      expiresIn: PRESIGN_EXPIRES_IN_SEC,
      // Block client-side overrides of the headers we signed so the upload
      // can't be reflected with a different Content-Type or Cache-Control.
      unhoistableHeaders: new Set([
        'content-type',
        'content-length',
        'cache-control',
      ]),
    });

    return {
      ok: true,
      value: {
        uploadUrl,
        publicUrl: buildPublicUrl(r2, key),
        key,
        expiresIn: PRESIGN_EXPIRES_IN_SEC,
        kind,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Failed to issue presigned URL: ${msg}` };
  }
}
