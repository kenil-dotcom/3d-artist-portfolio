/**
 * Pure media upload validator for project Media_Items.
 *
 * Implements Requirements 8.3 and 8.4 of the 3D Artist Portfolio spec and
 * Property 17 ("Media upload validation") from the design document.
 *
 * Per the design's `MediaPipeline.acceptUpload` contract, a file is admitted
 * iff:
 *
 *   - `kind = "image"`    AND `mimeType ∈ {image/jpeg, image/png, image/webp}`, OR
 *   - `kind = "video"`    AND `mimeType ∈ {video/mp4, video/webm}`, OR
 *   - `kind = "model3d"`  AND `mimeType ∈ {model/gltf+json, model/gltf-binary}`,
 *
 * AND `byteSize ≤ 100 MB`. Otherwise the upload is rejected with a stable
 * code (`invalid_format` or `file_too_large`) so the CMS can surface an
 * informative error and refrain from attaching the file to the Project.
 *
 * The `model/gltf-binary` MIME type is the canonical type for `.glb` files;
 * no separate file-extension handling is needed because the CMS upload path
 * normalises browser-supplied MIME types upstream.
 *
 * The function is pure: no I/O, no global state, never throws on bad inputs
 * (all error states are reported through the result), and never mutates the
 * supplied input object.
 */

import type {
  ImageMimeType,
  MediaKind,
  MediaMimeType,
  ModelMimeType,
  VideoMimeType,
} from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Stable rejection codes surfaced to the client and used by property tests.
 *
 *   - `invalid_format`: the supplied `mimeType` is not in the per-kind
 *     allowlist for the declared `kind`. This covers both wholly unknown
 *     formats (e.g. `application/pdf`) and known formats uploaded under the
 *     wrong kind (e.g. `image/jpeg` declared as `video`).
 *   - `file_too_large`: format is accepted for the declared `kind` but
 *     `byteSize` exceeds the 100 MB ceiling, or is non-finite/negative.
 */
export type MediaRejectionCode = 'invalid_format' | 'file_too_large';

/**
 * Minimal description of an uploaded file as parsed from the multipart
 * request. The validator only needs metadata; byte payloads are read by the
 * caller after validation succeeds.
 */
export interface MediaUploadInput {
  /** Media kind declared by the caller. */
  readonly kind: MediaKind;
  /** Reported MIME type (already lowercased by the caller). */
  readonly mimeType: string;
  /** Reported size in bytes. Must be a finite non-negative integer. */
  readonly byteSize: number;
  /** Filename as supplied by the Admin; echoed back in error messages. */
  readonly filename: string;
}

/**
 * Result of validation. `ok: true` means the file may be attached to the
 * Project; `ok: false` carries a stable code and a human-readable message.
 */
export type MediaValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: MediaRejectionCode;
      readonly message: string;
    };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONE_MB = 1024 * 1024;

/** 100 MB upload ceiling per Requirement 8.3. */
export const MAX_MEDIA_BYTES = 100 * ONE_MB;

/** Allowed image MIME types per Requirement 8.3. */
export const ALLOWED_IMAGE_MIME_TYPES: ReadonlyArray<ImageMimeType> = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** Allowed video MIME types per Requirement 8.3. */
export const ALLOWED_VIDEO_MIME_TYPES: ReadonlyArray<VideoMimeType> = [
  'video/mp4',
  'video/webm',
];

/**
 * Allowed 3D model MIME types per Requirement 8.3. `model/gltf-binary` is
 * the canonical MIME for `.glb` files; `model/gltf+json` covers `.gltf`.
 */
export const ALLOWED_MODEL_MIME_TYPES: ReadonlyArray<ModelMimeType> = [
  'model/gltf+json',
  'model/gltf-binary',
];

/** Per-kind allowlists exposed for consumers that need to mirror the rules. */
export const ALLOWED_MIME_TYPES_BY_KIND: Readonly<
  Record<MediaKind, ReadonlyArray<MediaMimeType>>
> = {
  image: ALLOWED_IMAGE_MIME_TYPES,
  video: ALLOWED_VIDEO_MIME_TYPES,
  model3d: ALLOWED_MODEL_MIME_TYPES,
};

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate a single media upload against the per-kind format allowlist and
 * the 100 MB size ceiling.
 *
 * Check order (deterministic):
 *   1. `mimeType` must be in the allowlist for `kind`; otherwise reject
 *      with `invalid_format`.
 *   2. `byteSize` must be a finite non-negative integer ≤ 100 MB; otherwise
 *      reject with `file_too_large`.
 *
 * @param input Metadata of the uploaded file (kind, mime, size, filename).
 */
export function validateMediaUpload(
  input: MediaUploadInput,
): MediaValidationResult {
  const { kind, mimeType, byteSize, filename } = input;
  const allowedForKind = ALLOWED_MIME_TYPES_BY_KIND[kind];

  // 1. Format check (kind-aware).
  if (!(allowedForKind as ReadonlyArray<string>).includes(mimeType)) {
    return {
      ok: false,
      code: 'invalid_format',
      message: invalidFormatMessage(filename, mimeType, kind, allowedForKind),
    };
  }

  // 2. Size ceiling. Defensive against non-finite or negative values that
  //    a caller may have produced from a malformed multipart frame.
  if (
    !Number.isFinite(byteSize) ||
    byteSize < 0 ||
    byteSize > MAX_MEDIA_BYTES
  ) {
    return {
      ok: false,
      code: 'file_too_large',
      message: tooLargeMessage(filename, byteSize, MAX_MEDIA_BYTES),
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

function invalidFormatMessage(
  filename: string,
  mimeType: string,
  kind: MediaKind,
  allowed: ReadonlyArray<string>,
): string {
  return `${filename}: format "${mimeType}" is not supported for ${kind}. Allowed: ${allowed.join(', ')}.`;
}

function tooLargeMessage(
  filename: string,
  byteSize: number,
  maxBytes: number,
): string {
  return `${filename}: file size ${formatBytes(byteSize)} exceeds the ${formatBytes(maxBytes)} limit.`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return `${bytes} bytes`;
  }
  if (bytes >= ONE_MB) {
    const mb = bytes / ONE_MB;
    return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(2)} MB`;
  }
  return `${bytes} bytes`;
}
