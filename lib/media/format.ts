/**
 * Pure helpers for image content negotiation and responsive variant
 * selection. Used by the media pipeline (`MediaPipeline.chooseImageFormat`
 * and `MediaPipeline.pickVariant` in `design.md`) to satisfy Requirements
 * 4.1, 4.2, and 4.3.
 *
 * These functions are intentionally side-effect free: they take primitive
 * inputs (the request `Accept` header, a viewport width, a list of variants)
 * and return a primitive decision. That keeps them trivial to exercise from
 * unit tests and property-based tests without any HTTP plumbing.
 */

import type { ImageFormat, ImageVariant } from "./types";

// ---------------------------------------------------------------------------
// Accept header parsing
// ---------------------------------------------------------------------------

/**
 * Parsed entry from an HTTP `Accept` header.
 *
 * `type` and `subtype` are lowercased so callers can compare them directly.
 * `q` is the quality value in `[0, 1]`; absent `q` parameters default to `1`
 * per RFC 9110 §12.4.2.
 */
interface AcceptEntry {
  readonly type: string;
  readonly subtype: string;
  readonly q: number;
}

/**
 * Parse a single comma-separated segment of an `Accept` header.
 *
 * Returns `null` for malformed segments (missing slash, empty type, etc.)
 * so that a single bad entry never causes the whole header to be ignored.
 *
 * Quality values are clamped to `[0, 1]`; non-numeric `q` parameters fall
 * back to `1` (treated as "no preference expressed").
 */
function parseAcceptEntry(segment: string): AcceptEntry | null {
  const trimmed = segment.trim();
  if (trimmed.length === 0) return null;

  const parts = trimmed.split(";");
  const mediaRange = parts[0]?.trim() ?? "";
  const slash = mediaRange.indexOf("/");
  if (slash <= 0 || slash === mediaRange.length - 1) return null;

  const type = mediaRange.slice(0, slash).toLowerCase();
  const subtype = mediaRange.slice(slash + 1).toLowerCase();
  if (type.length === 0 || subtype.length === 0) return null;

  let q = 1;
  for (let i = 1; i < parts.length; i++) {
    const param = parts[i]?.trim() ?? "";
    if (param.length === 0) continue;
    const eq = param.indexOf("=");
    if (eq <= 0) continue;
    const name = param.slice(0, eq).trim().toLowerCase();
    if (name !== "q") continue;
    const raw = param.slice(eq + 1).trim();
    const parsed = Number.parseFloat(raw);
    if (!Number.isFinite(parsed)) continue;
    q = Math.min(1, Math.max(0, parsed));
  }

  return { type, subtype, q };
}

/**
 * Returns `true` when the parsed `Accept` header explicitly accepts the
 * given image subtype with a positive quality value.
 *
 * Wildcards (`image/*`, `*\/*`) are intentionally **not** treated as
 * acceptance: per the design, they signal "no preference expressed" and
 * fall through to the JPEG fallback. Browsers that genuinely support
 * AVIF/WebP advertise the concrete media type in their `Accept` header, so
 * this rule mirrors real client behaviour while keeping the function safe
 * for legacy or unusual user agents.
 */
function acceptsImageSubtype(entries: ReadonlyArray<AcceptEntry>, subtype: string): boolean {
  const target = subtype.toLowerCase();
  for (const entry of entries) {
    if (entry.type === "image" && entry.subtype === target && entry.q > 0) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Choose the most efficient image format the client has explicitly
 * advertised support for.
 *
 * Precedence (Requirements 4.2, 4.3):
 *   1. `image/avif` with `q > 0` -> `"avif"`
 *   2. `image/webp` with `q > 0` -> `"webp"`
 *   3. otherwise -> `"jpeg"`
 *
 * `*\/*` and `image/*` are treated as "no preference" and resolve to
 * `"jpeg"`, matching the design's note that AVIF and WebP must be served
 * only when explicitly supported. This keeps clients that omit modern
 * subtypes (or send `q=0` for them) on the universally compatible JPEG
 * fallback.
 *
 * The function is total: any string (including the empty string,
 * `undefined`-like values converted to `""`, or malformed entries) returns
 * a valid `ImageFormat`.
 */
export function chooseImageFormat(acceptHeader: string): ImageFormat {
  if (typeof acceptHeader !== "string" || acceptHeader.length === 0) {
    return "jpeg";
  }

  const entries: AcceptEntry[] = [];
  for (const segment of acceptHeader.split(",")) {
    const entry = parseAcceptEntry(segment);
    if (entry !== null) entries.push(entry);
  }

  if (acceptsImageSubtype(entries, "avif")) return "avif";
  if (acceptsImageSubtype(entries, "webp")) return "webp";
  return "jpeg";
}

/**
 * Pick the responsive variant that best matches the requesting viewport.
 *
 * Selection rule (Requirement 4.1):
 *   - Among variants whose `width >= viewportWidth`, return the one with
 *     the smallest `width` (so we never download more pixels than needed).
 *   - When no variant is wide enough, return the variant with the largest
 *     `width` (so we degrade gracefully rather than upscale visually).
 *
 * Ties on `width` are resolved deterministically by preferring the
 * variant that appears earlier in the input list. This makes the function
 * pure with respect to its inputs and stable under repeated calls.
 *
 * Throws `Error` when `variants` is empty: callers must always have at
 * least one variant to serve, which the media pipeline guarantees per
 * Requirement 4.1.
 */
export function pickVariant(
  variants: ReadonlyArray<ImageVariant>,
  viewportWidth: number,
): ImageVariant {
  if (variants.length === 0) {
    throw new Error("pickVariant: variants must not be empty");
  }

  // Treat non-finite or non-positive viewport widths as "smallest possible"
  // so we still hand back the smallest available variant deterministically.
  const target = Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 0;

  let smallestAtLeastTarget: ImageVariant | null = null;
  let largestOverall: ImageVariant = variants[0]!;

  for (const variant of variants) {
    if (variant.width > largestOverall.width) {
      largestOverall = variant;
    }
    if (variant.width >= target) {
      if (smallestAtLeastTarget === null || variant.width < smallestAtLeastTarget.width) {
        smallestAtLeastTarget = variant;
      }
    }
  }

  return smallestAtLeastTarget ?? largestOverall;
}
