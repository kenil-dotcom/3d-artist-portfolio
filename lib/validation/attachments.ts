/**
 * Pure attachment validator for commission inquiry reference images.
 *
 * Implements Requirements 7.6 and 7.7 of the 3D Artist Portfolio spec and
 * Property 13 ("Attachment validation with partial rejection") from the
 * design document:
 *
 *   - Per-file size: at most 10 MB (`file_too_large`).
 *   - Combined accepted size: at most 50 MB (`total_too_large`).
 *   - Format: must be one of `image/jpeg`, `image/png`, `image/webp`
 *     (`invalid_format`).
 *   - Count: at most 5 accepted files (`too_many_files`).
 *
 * Per-file rejection semantics: an invalid file is rejected with a stable
 * code and a message that echoes the original filename, while every other
 * file submitted alongside it is still considered on its own merits. Files
 * are processed in submitted order; once the count or combined-size cap is
 * reached, subsequent files are rejected with `too_many_files` or
 * `total_too_large` respectively without affecting earlier acceptances.
 *
 * The function is pure: it does not perform I/O, does not throw on bad
 * inputs (every error is reported as a rejection), and never mutates the
 * supplied list.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Stable rejection codes surfaced to the client and used by property tests.
 * The codes are intentionally narrow so localized messages and UI logic can
 * match on them exhaustively.
 */
export type AttachmentRejectionCode =
  | 'file_too_large'
  | 'total_too_large'
  | 'invalid_format'
  | 'too_many_files';

/**
 * Minimal description of an uploaded file as parsed from the multipart
 * request. The validator only needs metadata; byte payloads are read by the
 * caller after validation succeeds.
 */
export interface AttachmentInput {
  /** Filename as supplied by the visitor; echoed back in error messages. */
  readonly originalFilename: string;
  /** Reported MIME type (already lowercased by the caller). */
  readonly mimeType: string;
  /** Reported size in bytes. Must be a finite non-negative integer. */
  readonly byteSize: number;
}

/**
 * Rejection record paired with the offending file and a stable reason code.
 */
export interface AttachmentRejection {
  readonly file: AttachmentInput;
  readonly code: AttachmentRejectionCode;
  readonly message: string;
}

/**
 * Outcome of validation. The two arrays partition the input list:
 * `|files| = |accepted| + |rejected|`.
 */
export interface AttachmentValidationResult {
  readonly accepted: ReadonlyArray<AttachmentInput>;
  readonly rejected: ReadonlyArray<AttachmentRejection>;
}

/**
 * Optional override knobs, primarily intended for tests. Production callers
 * should rely on the defaults which mirror the spec.
 */
export interface AttachmentLimits {
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
  readonly maxFiles?: number;
  readonly allowedMimeTypes?: ReadonlyArray<string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ONE_MB = 1024 * 1024;

/** Default per-file size cap (10 MB) per Requirement 7.6. */
export const DEFAULT_MAX_FILE_BYTES = 10 * ONE_MB;
/** Default combined-size cap (50 MB) per Requirement 7.6. */
export const DEFAULT_MAX_TOTAL_BYTES = 50 * ONE_MB;
/** Default maximum number of accepted attachments per Requirement 7.6. */
export const DEFAULT_MAX_FILES = 5;
/** Default mime-type allowlist per Requirement 7.6. */
export const DEFAULT_ALLOWED_MIME_TYPES: ReadonlyArray<string> = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate a list of uploaded attachment metadata, partitioning it into
 * `accepted` and `rejected` entries.
 *
 * The function is total: every input ends up in exactly one bucket and the
 * sum of bucket sizes equals the input length. Acceptance is order-aware so
 * that the global count and combined-size caps are applied deterministically
 * to the visitor's submission order.
 *
 * @param files  Files in submitted order.
 * @param limits Optional caps. Defaults match the spec.
 */
export function validateAttachments(
  files: ReadonlyArray<AttachmentInput>,
  limits: AttachmentLimits = {},
): AttachmentValidationResult {
  const maxFileBytes = limits.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = limits.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxFiles = limits.maxFiles ?? DEFAULT_MAX_FILES;
  const allowedList = limits.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;
  const allowedSet = new Set<string>(allowedList);

  const accepted: AttachmentInput[] = [];
  const rejected: AttachmentRejection[] = [];
  let runningBytes = 0;

  for (const file of files) {
    // 1. Format check first so a wrong-format file is never blamed on the
    //    per-file size or global caps.
    if (!allowedSet.has(file.mimeType)) {
      rejected.push({
        file,
        code: 'invalid_format',
        message: formatUnsupportedMessage(file, allowedList),
      });
      continue;
    }

    // 2. Per-file size. Defensive against non-finite or negative values that
    //    a caller may have produced from a malformed multipart frame.
    if (
      !Number.isFinite(file.byteSize) ||
      file.byteSize < 0 ||
      file.byteSize > maxFileBytes
    ) {
      rejected.push({
        file,
        code: 'file_too_large',
        message: fileTooLargeMessage(file, maxFileBytes),
      });
      continue;
    }

    // 3. Global count cap. Once the cap is hit, every remaining valid file is
    //    rejected with `too_many_files` while the earlier acceptances stand.
    if (accepted.length >= maxFiles) {
      rejected.push({
        file,
        code: 'too_many_files',
        message: tooManyFilesMessage(file, maxFiles),
      });
      continue;
    }

    // 4. Combined-size cap. A file that would push the running total past
    //    the cap is rejected, but earlier acceptances and later files that
    //    individually fit are unaffected.
    if (runningBytes + file.byteSize > maxTotalBytes) {
      rejected.push({
        file,
        code: 'total_too_large',
        message: totalTooLargeMessage(file, maxTotalBytes),
      });
      continue;
    }

    accepted.push(file);
    runningBytes += file.byteSize;
  }

  return { accepted, rejected };
}

// ---------------------------------------------------------------------------
// Message helpers
// ---------------------------------------------------------------------------

function formatUnsupportedMessage(
  file: AttachmentInput,
  allowed: ReadonlyArray<string>,
): string {
  return `${file.originalFilename}: format "${file.mimeType}" is not supported. Allowed formats: ${allowed.join(', ')}.`;
}

function fileTooLargeMessage(file: AttachmentInput, maxBytes: number): string {
  return `${file.originalFilename}: file size ${formatBytes(file.byteSize)} exceeds the per-file limit of ${formatBytes(maxBytes)}.`;
}

function tooManyFilesMessage(file: AttachmentInput, maxFiles: number): string {
  return `${file.originalFilename}: cannot attach more than ${maxFiles} files per submission.`;
}

function totalTooLargeMessage(file: AttachmentInput, maxBytes: number): string {
  return `${file.originalFilename}: combined attachment size would exceed the ${formatBytes(maxBytes)} limit.`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return `${bytes} bytes`;
  }
  if (bytes >= ONE_MB) {
    const mb = bytes / ONE_MB;
    // Trim trailing zeros for whole-MB values.
    return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(2)} MB`;
  }
  return `${bytes} bytes`;
}
