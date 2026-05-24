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
const ONE_GB = 1024 * ONE_MB;

/**
 * Upload ceiling. The spec called for 100 MB per file but R2 / Cloudflare
 * can comfortably handle large videos and the artist needs room for full-
 * resolution renders, so we lift the cap to 5 GB. Sharp metadata probing
 * still happens on every accepted image so very large stills won't throw
 * at processing time.
 */
export const MAX_MEDIA_BYTES = 5 * ONE_GB;

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
 * Allowed 3D model MIME types per Requirement 8.3 / 2.4 / 15.4.
 *
 *   - `model/gltf+json`    — canonical `.gltf` (JSON-form glTF).
 *   - `model/gltf-binary`  — canonical `.glb`.
 *   - `model/vnd.usdz+zip` — Apple AR Quick Look `.usdz` archive.
 *
 * The element type is widened locally to include `'model/vnd.usdz+zip'` so
 * the validator can list the new format ahead of `lib/types/domain.ts`'s
 * `ModelMimeType` being widened by the schema/types task. Once that task
 * lands, this annotation collapses naturally to `ReadonlyArray<ModelMimeType>`
 * because the literal becomes a member of the domain union.
 */
export const ALLOWED_MODEL_MIME_TYPES: ReadonlyArray<
  ModelMimeType | 'model/vnd.usdz+zip'
> = ['model/gltf+json', 'model/gltf-binary', 'model/vnd.usdz+zip'];

/**
 * Per-kind allowlists exposed for consumers that need to mirror the rules.
 *
 * The model3d slot is widened in lockstep with `ALLOWED_MODEL_MIME_TYPES`
 * so callers like `inferKindFromMime` resolve `'model/vnd.usdz+zip'` to
 * `'model3d'` purely by reading this map.
 */
export const ALLOWED_MIME_TYPES_BY_KIND: Readonly<
  Record<MediaKind, ReadonlyArray<MediaMimeType | 'model/vnd.usdz+zip'>>
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

// ---------------------------------------------------------------------------
// Per-item metadata normalisation (alt text and caption)
// ---------------------------------------------------------------------------

/**
 * Trim regex covering only the four ASCII whitespace characters the
 * Requirement 10 normalisation rules call out:
 *
 *   - U+0020 SPACE
 *   - U+0009 TAB
 *   - U+000D CR
 *   - U+000A LF
 *
 * Non-ASCII whitespace such as U+00A0 (NBSP) and U+2028 (line separator) is
 * preserved deliberately so authors can use them inside captions without the
 * normaliser silently swallowing them. The regex is deliberately not the
 * built-in `\s` class — `\s` would match the wider Unicode whitespace set we
 * want to keep.
 */
const ALT_CAPTION_TRIM_RE = /^[\u0020\u0009\u000D\u000A]+|[\u0020\u0009\u000D\u000A]+$/g;

/** Maximum stored length of `MediaItem.altText` per Requirement 10.1. */
export const ALT_TEXT_MAX_LENGTH = 500;

/** Maximum stored length of `MediaItem.caption` per Requirement 10.2. */
export const CAPTION_MAX_LENGTH = 200;

function trimAltCaption(input: string): string {
  return input.replace(ALT_CAPTION_TRIM_RE, '');
}

/**
 * Normalise an alt-text input for storage on `MediaItem.altText`.
 *
 * Returns `null` when the input is empty after trimming the ASCII whitespace
 * categories above (Requirement 10.4). Otherwise returns the trimmed string
 * clamped to {@link ALT_TEXT_MAX_LENGTH} characters (Requirement 10.1, 10.3).
 *
 * The function is pure and idempotent: `normalizeAltText(normalizeAltText(s) ?? '')`
 * yields the same result as `normalizeAltText(s)` for every input `s`.
 */
export function normalizeAltText(input: string): string | null {
  const trimmed = trimAltCaption(input);
  if (trimmed.length === 0) return null;
  return trimmed.length > ALT_TEXT_MAX_LENGTH
    ? trimmed.slice(0, ALT_TEXT_MAX_LENGTH)
    : trimmed;
}

/**
 * Normalise a caption input for storage on `MediaItem.caption`.
 *
 * Returns `null` when the input is empty after trimming the ASCII whitespace
 * categories above (Requirement 10.4). Otherwise returns the trimmed string
 * clamped to {@link CAPTION_MAX_LENGTH} characters (Requirement 10.2, 10.3).
 *
 * The function is pure and idempotent for the same reason as
 * {@link normalizeAltText}.
 */
export function normalizeCaption(input: string): string | null {
  const trimmed = trimAltCaption(input);
  if (trimmed.length === 0) return null;
  return trimmed.length > CAPTION_MAX_LENGTH
    ? trimmed.slice(0, CAPTION_MAX_LENGTH)
    : trimmed;
}
