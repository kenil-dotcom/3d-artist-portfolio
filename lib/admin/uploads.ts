/**
 * Admin upload pipeline backed by Cloudflare R2 (S3-compatible).
 *
 * Files are uploaded directly to the configured R2 bucket and served from
 * the bucket's public `r2.dev` URL (or a custom domain mapped to the
 * bucket). The `storageKey` field stored on `MediaItem` / `Bio` rows is
 * the **fully qualified public URL** so the public site can render it
 * with `<img src={storageKey}>` without further URL composition.
 *
 * Why store the full URL rather than a key? R2's public URL is stable
 * for the life of the bucket and embedding it directly:
 *
 *   - Simplifies the public render path (no extra config join needed).
 *   - Lets the same DB row keep working if the public URL is later
 *     swapped for a custom CDN domain (we only update existing rows).
 *
 * For development without R2 credentials, the pipeline falls back to
 * writing to `public/uploads/` so contributors can still iterate locally.
 * The fallback is not used in production.
 */

import 'server-only';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';
import {
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';

import {
  ALLOWED_MIME_TYPES_BY_KIND,
  validateMediaUpload,
  type MediaValidationResult,
} from '@/lib/validation/media';
import type { MediaKind } from '@/lib/types/domain';

const PUBLIC_DIR = join(process.cwd(), 'public');
const UPLOADS_ROOT = join(PUBLIC_DIR, 'uploads');

/**
 * Map a MIME type to a stable, lowercase file extension. Unknown types
 * fall back to `bin` so the file is still written but never confused
 * with a known format.
 */
const MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'model/gltf+json': 'gltf',
  'model/gltf-binary': 'glb',
  'application/pdf': 'pdf',
};

export interface StoredUpload {
  /** Fully qualified public URL for the uploaded asset. */
  readonly storageKey: string;
  readonly contentHash: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly extension: string;
}

export interface MediaUploadResult extends StoredUpload {
  readonly kind: MediaKind;
}

/**
 * Compute the SHA-256 hash of a buffer as a hex string, truncated to
 * 64 chars (the schema's `contentHash` width).
 */
function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex').slice(0, 64);
}

function inferKindFromMime(mime: string): MediaKind | null {
  if ((ALLOWED_MIME_TYPES_BY_KIND.image as ReadonlyArray<string>).includes(mime)) {
    return 'image';
  }
  if ((ALLOWED_MIME_TYPES_BY_KIND.video as ReadonlyArray<string>).includes(mime)) {
    return 'video';
  }
  if ((ALLOWED_MIME_TYPES_BY_KIND.model3d as ReadonlyArray<string>).includes(mime)) {
    return 'model3d';
  }
  return null;
}

// ---------------------------------------------------------------------------
// R2 client (lazy, cached)
// ---------------------------------------------------------------------------

interface R2Config {
  readonly client: S3Client;
  readonly bucket: string;
  readonly publicBaseUrl: string;
}

let cachedR2: R2Config | null = null;

/**
 * Resolve R2 client and bucket from `process.env`. Returns `null` when
 * any required value is missing so callers can fall back to local-disk
 * storage in dev without env vars.
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

async function putToR2(
  cfg: R2Config,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await cfg.client.send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // R2 public buckets serve any object that exists, no ACL needed.
      // Cache for a year — we already content-hash the filename, so
      // re-uploading the same image is idempotent and CDN-immutable.
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

function r2Url(cfg: R2Config, key: string): string {
  return `${cfg.publicBaseUrl}/${key
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}

// ---------------------------------------------------------------------------
// Local-disk fallback (dev only when R2 is unconfigured)
// ---------------------------------------------------------------------------

async function putToLocalDisk(
  scope: string,
  filename: string,
  body: Buffer,
): Promise<string> {
  const targetDir = join(UPLOADS_ROOT, scope);
  await mkdir(targetDir, { recursive: true });
  await writeFile(join(targetDir, filename), body);
  return `/uploads/${scope}/${filename}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Persist a media file for a project. Validates, hashes, uploads to R2
 * (or local disk in dev), and probes images for intrinsic dimensions.
 */
export async function storeProjectMedia(
  projectId: string,
  file: File,
): Promise<
  | { readonly ok: true; readonly value: MediaUploadResult }
  | { readonly ok: false; readonly error: string }
> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = (file.type || 'application/octet-stream').toLowerCase();
  const kind = inferKindFromMime(mimeType);
  if (kind === null) {
    return {
      ok: false,
      error: `${file.name}: unsupported format "${mimeType}".`,
    };
  }

  const validation: MediaValidationResult = validateMediaUpload({
    kind,
    mimeType,
    byteSize: buf.byteLength,
    filename: file.name,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.message };
  }

  const contentHash = hashBuffer(buf);
  const extension = MIME_TO_EXT[mimeType] ?? 'bin';
  const key = `media/${projectId}/${contentHash}.${extension}`;
  const filename = `${contentHash}.${extension}`;

  let storageKey: string;
  const r2 = resolveR2();
  if (r2 !== null) {
    try {
      await putToR2(r2, key, buf, mimeType);
      storageKey = r2Url(r2, key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `${file.name}: R2 upload failed (${msg}).` };
    }
  } else {
    storageKey = await putToLocalDisk(projectId, filename, buf);
  }

  let width: number | null = null;
  let height: number | null = null;
  if (kind === 'image') {
    try {
      const meta = await sharp(buf).metadata();
      width = typeof meta.width === 'number' ? meta.width : null;
      height = typeof meta.height === 'number' ? meta.height : null;
    } catch {
      // Probing is best-effort; the file is still saved.
    }
  }

  return {
    ok: true,
    value: {
      kind,
      storageKey,
      contentHash,
      mimeType,
      byteSize: buf.byteLength,
      width,
      height,
      extension,
    },
  };
}

/**
 * Persist a bio asset (profile image or resume PDF).
 */
export async function storeBioAsset(
  file: File,
  options: {
    readonly allowedMimeTypes: ReadonlyArray<string>;
    readonly maxBytes: number;
    readonly probeImage: boolean;
  },
): Promise<
  | { readonly ok: true; readonly value: StoredUpload }
  | { readonly ok: false; readonly error: string }
> {
  const buf = Buffer.from(await file.arrayBuffer());
  const mimeType = (file.type || 'application/octet-stream').toLowerCase();

  if (!(options.allowedMimeTypes as ReadonlyArray<string>).includes(mimeType)) {
    return {
      ok: false,
      error: `${file.name}: format "${mimeType}" is not supported. Allowed: ${options.allowedMimeTypes.join(', ')}.`,
    };
  }
  if (buf.byteLength > options.maxBytes) {
    return {
      ok: false,
      error: `${file.name}: file exceeds the ${Math.round(options.maxBytes / (1024 * 1024))} MB limit.`,
    };
  }

  const contentHash = hashBuffer(buf);
  const extension = MIME_TO_EXT[mimeType] ?? 'bin';
  const filename = `${contentHash}.${extension}`;
  const key = `bio/${filename}`;

  let storageKey: string;
  const r2 = resolveR2();
  if (r2 !== null) {
    try {
      await putToR2(r2, key, buf, mimeType);
      storageKey = r2Url(r2, key);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `${file.name}: R2 upload failed (${msg}).` };
    }
  } else {
    storageKey = await putToLocalDisk('bio', filename, buf);
  }

  let width: number | null = null;
  let height: number | null = null;
  if (options.probeImage) {
    try {
      const meta = await sharp(buf).metadata();
      width = typeof meta.width === 'number' ? meta.width : null;
      height = typeof meta.height === 'number' ? meta.height : null;
    } catch {
      // ignore
    }
  }

  return {
    ok: true,
    value: {
      storageKey,
      contentHash,
      mimeType,
      byteSize: buf.byteLength,
      width,
      height,
      extension,
    },
  };
}
