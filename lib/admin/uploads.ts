/**
 * Local upload pipeline used by the admin CMS.
 *
 * Files are written under `public/uploads/<scope>/<contentHash>.<ext>`
 * where `scope` is the project id (`uploads/{projectId}/`) or the
 * literal `bio` (`uploads/bio/`). The path is also the `storageKey`
 * stored on the corresponding `MediaItem` / `Bio` row, so the public
 * site reads it as a normal `/uploads/...` URL through Next.js' static
 * file serving.
 *
 * IMPORTANT: this storage backend is only suitable for local
 * development and zero-downtime deployments. On Vercel's serverless
 * runtime the public folder is read-only at runtime; switch to S3/R2
 * before going to production. See README "Image storage" notes.
 */

import 'server-only';

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import sharp from 'sharp';

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

/**
 * Persist a media file for a project. Validates against the
 * `validateMediaUpload` rules, hashes the bytes, writes them to
 * `public/uploads/<projectId>/<hash>.<ext>`, and probes images for
 * intrinsic dimensions via `sharp`.
 *
 * @returns the stored metadata or a structured error suitable for
 * inline UI feedback.
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

  const targetDir = join(UPLOADS_ROOT, projectId);
  await mkdir(targetDir, { recursive: true });
  const filename = `${contentHash}.${extension}`;
  const fullPath = join(targetDir, filename);
  await writeFile(fullPath, buf);

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

  const storageKey = `/uploads/${projectId}/${filename}`;
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
 * Persist a bio asset (profile image or resume PDF) under
 * `public/uploads/bio/`. Validation is parameterised by the expected
 * mime allow-list and per-file size cap.
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

  const targetDir = join(UPLOADS_ROOT, 'bio');
  await mkdir(targetDir, { recursive: true });
  const filename = `${contentHash}.${extension}`;
  const fullPath = join(targetDir, filename);
  await writeFile(fullPath, buf);

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
      storageKey: `/uploads/bio/${filename}`,
      contentHash,
      mimeType,
      byteSize: buf.byteLength,
      width,
      height,
      extension,
    },
  };
}
