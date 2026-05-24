/**
 * Image variant generation pipeline.
 *
 * For every newly uploaded image-kind Media_Item, the editor produces a set
 * of AVIF and WebP renditions at the target widths defined in Requirement
 * 6.1 (`400`, `800`, `1600`, `2400`). The renditions are written to R2 under
 * the `variants/{mediaId}/{width}.{ext}` key prefix and persisted on
 * `MediaItem.variantSet` so the public renderer can emit a `<picture>`
 * element with the smallest acceptable rendition (Requirement 6.5).
 *
 * Design constraints (see `design.md` "Variant generation pipeline"):
 *
 *   - **Never upscale.** `planVariantWidths` filters the target list so
 *     widths exceeding `originalWidth * 1.1` are dropped (Requirement 6.2).
 *   - **Per-rendition resilience.** Each `(width, format)` pair is wrapped
 *     in its own try/catch with a 3-attempt retry budget so one bad
 *     encoder never poisons the rest of the set (Requirement 6.4). Each
 *     failure is recorded on the returned `VariantSet` with the cause
 *     truncated to 200 characters (Requirement 6.7).
 *   - **Memory-friendly large sources.** Sources `<= 32 MB` use
 *     `pipeline.toBuffer()`; larger sources fall through `tmpdir()` via
 *     `pipeline.toFile()` so the decoded buffer never lives entirely in
 *     RAM.
 *   - **I/O via injected `put`.** The R2 client is supplied as a
 *     dependency so the pipeline is testable in isolation; this module
 *     never imports `@/lib/admin/uploads.ts` or any S3 SDK directly.
 *
 * This module is `server-only` so it cannot leak into a client bundle —
 * sharp is a native binary and must never load in the browser.
 */

import 'server-only';

import { randomBytes } from 'node:crypto';
import { readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import sharp from 'sharp';

import type {
  Variant,
  VariantFailure,
  VariantFormat,
  VariantSet,
} from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Target rendition widths in pixels (Requirement 6.1). */
const VARIANT_WIDTHS: ReadonlyArray<number> = [400, 800, 1600, 2400];

/** Output formats produced for every selected width (Requirement 6.1). */
const VARIANT_FORMATS: ReadonlyArray<VariantFormat> = ['avif', 'webp'];

/**
 * Maximum attempts (initial plus retries) for a single rendition before
 * the failure is recorded. Aligns with the per-file upload retry budget
 * defined in Requirement 13.4 / 13.5.
 */
const MAX_RENDITION_ATTEMPTS = 3;

/**
 * Source-buffer threshold above which sharp streams its output through a
 * temp file rather than holding the decoded buffer in RAM. Matches the
 * 32 MB threshold called out in `design.md` "Variant generation pipeline".
 */
const TO_FILE_THRESHOLD_BYTES = 32 * 1024 * 1024;

/** Bound enforced on every `VariantFailure.cause` string (Requirement 6.7). */
const CAUSE_MAX_CHARS = 200;

const FORMAT_CONTENT_TYPE: Readonly<Record<VariantFormat, string>> = {
  avif: 'image/avif',
  webp: 'image/webp',
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GenerateVariantsInput {
  /** Owning Media_Item id; used as the key prefix in R2. */
  readonly mediaId: string;
  /** Original image bytes. */
  readonly sourceBuffer: Buffer;
  /** Intrinsic pixel width of the source image. */
  readonly originalWidth: number;
}

/**
 * Persistence dependency. The pipeline never constructs an S3 client of
 * its own — callers (the upload action, tests) inject this callback so the
 * module is trivially mockable.
 */
export interface VariantPutDeps {
  /**
   * Persist a single rendition's bytes under `key` and return the
   * resolved public URL plus the stored byte length. Implementations may
   * throw on transient failure; the pipeline retries up to
   * `MAX_RENDITION_ATTEMPTS` times before recording a `VariantFailure`.
   */
  readonly put: (
    key: string,
    body: Buffer,
    contentType: string,
  ) => Promise<{ readonly url: string; readonly byteSize: number }>;
}

/**
 * Cleanup dependency. Mirrors {@link VariantPutDeps} so the helper can
 * be exercised in tests with an in-memory store rather than reaching
 * for the live R2 client.
 */
export interface VariantRemoveDeps {
  /**
   * Remove the object stored at `key`. Implementations should be
   * best-effort: a missing object MUST resolve, not throw, because
   * {@link deleteVariantKeys} is invoked when no variant set is known
   * to exist (e.g., legacy rows uploaded before the variant pipeline
   * landed).
   */
  readonly remove: (key: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Width planner
// ---------------------------------------------------------------------------

/**
 * Pick the subset of {@link VARIANT_WIDTHS} that does not upscale the
 * source. A width `w` is kept iff `w <= originalWidth * 1.1` so the 10%
 * tolerance from Requirement 6.2 is respected. The result is monotonically
 * ascending (filter preserves input order).
 *
 * Non-finite, zero, or negative `originalWidth` produces an empty plan —
 * such inputs cannot be image-kind Media_Items per Requirement 2.9 / 2.10
 * and the pipeline should record nothing rather than throw.
 */
export function planVariantWidths(originalWidth: number): ReadonlyArray<number> {
  if (!Number.isFinite(originalWidth) || originalWidth <= 0) return [];
  const cap = originalWidth * 1.1;
  return VARIANT_WIDTHS.filter((w) => w <= cap);
}

// ---------------------------------------------------------------------------
// Rendition pipeline
// ---------------------------------------------------------------------------

function applyFormat(pipeline: sharp.Sharp, format: VariantFormat): sharp.Sharp {
  return format === 'avif' ? pipeline.avif() : pipeline.webp();
}

/**
 * Bound the cause string to {@link CAUSE_MAX_CHARS}. Truncation is
 * unconditional per Requirement 6.7 — short causes still pass through
 * `slice(0, 200)` so the bound is enforced uniformly.
 */
function truncateCause(cause: string): string {
  return cause.slice(0, CAUSE_MAX_CHARS);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return 'unknown error';
}

/**
 * Encode a single rendition. Routes to `toBuffer()` for small sources and
 * to `toFile()` against `tmpdir()` for sources beyond
 * {@link TO_FILE_THRESHOLD_BYTES}. The temp file is removed on every exit
 * path so a failed encode never leaks bytes onto disk.
 */
async function encodeRendition(
  sourceBuffer: Buffer,
  width: number,
  format: VariantFormat,
): Promise<{ readonly body: Buffer; readonly height: number }> {
  const pipeline = applyFormat(
    sharp(sourceBuffer).resize({ width, withoutEnlargement: true }),
    format,
  );

  if (sourceBuffer.byteLength <= TO_FILE_THRESHOLD_BYTES) {
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { body: data, height: info.height };
  }

  const tmpPath = join(
    tmpdir(),
    `variant-${randomBytes(9).toString('hex')}-${width}.${format}`,
  );
  try {
    const info = await pipeline.toFile(tmpPath);
    const data = await readFile(tmpPath);
    return { body: data, height: info.height };
  } finally {
    try {
      await unlink(tmpPath);
    } catch {
      // Best-effort cleanup; missing-file errors after a failed encode
      // are expected and never escalated.
    }
  }
}

/** Single attempt: encode the rendition and write it via the injected `put`. */
async function attemptRendition(
  input: GenerateVariantsInput,
  width: number,
  format: VariantFormat,
  deps: VariantPutDeps,
): Promise<Variant> {
  const { body, height } = await encodeRendition(
    input.sourceBuffer,
    width,
    format,
  );
  const key = `variants/${input.mediaId}/${width}.${format}`;
  const { url, byteSize } = await deps.put(key, body, FORMAT_CONTENT_TYPE[format]);
  return { format, width, height, storageKey: url, byteSize };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Run the sharp pipeline for every `(width, format)` pair derived from
 * {@link planVariantWidths}, persist each rendition via `deps.put`, and
 * return a {@link VariantSet} recording successes and per-rendition
 * failures.
 *
 * Every rendition gets up to {@link MAX_RENDITION_ATTEMPTS} attempts
 * before its failure is recorded; the loop never short-circuits, so a
 * single bad encoder cannot prevent the others from completing
 * (Requirement 6.4). The resulting `VariantSet` is safe to persist
 * directly on `MediaItem.variantSet` — the public renderer treats an
 * empty `renditions` array as the legacy fallback path (Requirement 6.6).
 */
export async function generateVariants(
  input: GenerateVariantsInput,
  deps: VariantPutDeps,
): Promise<VariantSet> {
  const widths = planVariantWidths(input.originalWidth);
  const renditions: Variant[] = [];
  const failures: VariantFailure[] = [];

  for (const width of widths) {
    for (const format of VARIANT_FORMATS) {
      let lastError = '';
      let recorded = false;
      for (let attempt = 1; attempt <= MAX_RENDITION_ATTEMPTS; attempt++) {
        try {
          const variant = await attemptRendition(input, width, format, deps);
          renditions.push(variant);
          recorded = true;
          break;
        } catch (err) {
          lastError = describeError(err);
        }
      }
      if (!recorded) {
        failures.push({
          format,
          width,
          cause: truncateCause(lastError),
        });
      }
    }
  }

  return { renditions, failures };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Remove every R2 object that {@link generateVariants} could have
 * written for the given Media_Item. Used by both the replace-file path
 * (where variants are invalidated before a regenerate) and by
 * `deleteMediaItem` so deleting a row does not leave orphan renditions
 * behind (Requirement 6.8).
 *
 * Variant keys are deterministic — every rendition lives at
 * `variants/{mediaId}/{width}.{format}` — so the cleanup iterates the
 * full cross-product of {@link VARIANT_WIDTHS} and {@link VARIANT_FORMATS}.
 * That is up to eight keys per Media_Item, which is well within budget
 * for a single transaction. Listing the bucket by prefix would also work
 * but is unnecessary when the key shape is fixed.
 *
 * Per-key failures are swallowed: a missing object is the success
 * outcome (the row is on its way out), and a transient R2 error on one
 * key should not stop the cleanup from removing the other seven. The
 * caller decides whether to wrap the function in a transaction; this
 * helper is best-effort and never throws.
 */
export async function deleteVariantKeys(
  mediaId: string,
  deps: VariantRemoveDeps,
): Promise<void> {
  if (mediaId.length === 0) return;
  for (const width of VARIANT_WIDTHS) {
    for (const format of VARIANT_FORMATS) {
      const key = `variants/${mediaId}/${width}.${format}`;
      try {
        await deps.remove(key);
      } catch {
        // Best-effort — keep iterating so one bad delete does not
        // strand the remaining seven variants in R2.
      }
    }
  }
}
