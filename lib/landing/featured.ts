/**
 * Landing-page featured project selection.
 *
 * Pure function: given the admin-curated `configured` set and the full set of
 * `published` projects, return the list of projects to render in the landing
 * page's featured section, plus a `usedFallback` flag indicating which branch
 * produced the result.
 *
 * Selection rules (in priority order):
 *
 *   1. If `configured.length` is in the 3..8 band, return the first 8 entries
 *      of `configured` in the order supplied (the cap is defensive — the band
 *      already lies within `[0, 8]`). The caller is expected to have filtered
 *      `configured` to published projects in admin display order.
 *      `usedFallback = "none"`. Matches Requirement 1.3.
 *
 *   2. Otherwise, when at least 6 published projects exist, return the 6 most
 *      recently published in `publishedAt`-descending order
 *      (Requirement 1.6). `usedFallback = "recent"`.
 *
 *   3. Otherwise, when 1..5 published projects exist, return all of them in
 *      `publishedAt`-descending order (Requirement 1.7).
 *      `usedFallback = "recent"`.
 *
 *   4. Otherwise (no published projects), return an empty list with
 *      `usedFallback = "empty"` so the UI can render the "featured work is
 *      not yet available" message (Requirement 1.8).
 *
 * Configured-set sizes outside the 3..8 band (i.e. 0, 1, 2, or 9..12 per the
 * 0..12 storage range allowed by Requirement 8.10) are treated as "no valid
 * configured set" and trigger the fallback branches above. This keeps the
 * landing page within the displayed-count window mandated by Requirement 1.3
 * even when the CMS holds a smaller or larger feature list.
 *
 * Ties are broken deterministically: when two `published` projects share a
 * `publishedAt` timestamp the one with the smaller `id` sorts first, so the
 * function is referentially transparent and safe to drive from
 * property-based tests (Task 3.4 / design's Property 2).
 *
 * The function performs no I/O, reads no ambient time or environment, and
 * never mutates either input array.
 *
 * Spec references: Requirements 1.3, 1.6, 1.7, 1.8 and design "Property 2:
 * Landing featured selection".
 */

import type { Project } from "@/lib/types/domain";

/** Discriminator for which branch produced the items list. */
export type LandingFeaturedFallback = "none" | "recent" | "empty";

/**
 * Inputs to {@link selectLandingFeatured}.
 *
 * - `configured` is the admin-curated featured set, already filtered to
 *   `status === "published"` and arranged in the admin's display order.
 * - `published` is the full set of `status === "published"` projects (which
 *   typically contains every entry of `configured`, plus any non-featured
 *   published projects). Order is irrelevant; the function sorts internally.
 */
export interface LandingFeaturedInput {
  readonly configured: ReadonlyArray<Project>;
  readonly published: ReadonlyArray<Project>;
}

/**
 * Result of {@link selectLandingFeatured}.
 *
 * - `items` is the ordered list of projects to render. Length is always
 *   between 0 and 8 inclusive.
 * - `usedFallback` indicates which branch produced `items`:
 *     - `"none"`   → the admin-curated `configured` set was used as-is.
 *     - `"recent"` → the most-recent-published fallback was used.
 *     - `"empty"`  → no published projects exist; render the placeholder.
 */
export interface LandingFeaturedResult {
  readonly items: ReadonlyArray<Project>;
  readonly usedFallback: LandingFeaturedFallback;
}

/** Inclusive lower bound on the displayed featured count (Requirement 1.3). */
const FEATURED_MIN = 3;
/** Inclusive upper bound on the displayed featured count (Requirement 1.3). */
const FEATURED_MAX = 8;
/** Cap on the number of fallback "most recent" projects (Requirement 1.6). */
const RECENT_FALLBACK_LIMIT = 6;

/**
 * Select the projects to render in the landing page's featured section.
 *
 * @param input.configured Admin-curated featured projects in admin order
 *                         (already filtered to `status === "published"`).
 * @param input.published  Full set of published projects, in any order.
 * @returns                Ordered list of projects plus a `usedFallback`
 *                         discriminator. Neither input array is mutated.
 */
export function selectLandingFeatured(
  input: LandingFeaturedInput,
): LandingFeaturedResult {
  const { configured, published } = input;

  // Step 1: prefer the admin-curated set when its size lies in the 3..8 band
  // mandated by Requirement 1.3. The slice is defensive — within the band
  // `length` already lies in `[0, FEATURED_MAX]`.
  if (
    configured.length >= FEATURED_MIN &&
    configured.length <= FEATURED_MAX
  ) {
    return {
      items: configured.slice(0, FEATURED_MAX),
      usedFallback: "none",
    };
  }

  // Step 2-4: fall back to most-recent-published.
  if (published.length === 0) {
    return { items: [], usedFallback: "empty" };
  }

  const recents = sortByPublishedAtDesc(published);
  const limit = Math.min(recents.length, RECENT_FALLBACK_LIMIT);
  return {
    items: recents.slice(0, limit),
    usedFallback: "recent",
  };
}

/**
 * Sort the given published projects by `publishedAt` descending, breaking
 * ties by `id` ascending. Returns a new array; the input is not mutated.
 *
 * `publishedAt` should always be set on a published project per the design's
 * publish workflow (it is written when status flips to "published"). For
 * defensive purposes a missing or unparseable timestamp is treated as
 * `-Infinity` so it sorts to the end of a "newest first" list rather than
 * throwing.
 */
function sortByPublishedAtDesc(
  projects: ReadonlyArray<Project>,
): ReadonlyArray<Project> {
  return [...projects].sort((a, b) => {
    const at = parsePublishedAtMs(a.publishedAt);
    const bt = parsePublishedAtMs(b.publishedAt);
    if (at !== bt) {
      return bt - at; // descending
    }
    return compareIdAsc(a.id, b.id);
  });
}

function parsePublishedAtMs(ts: string | null): number {
  if (ts === null) {
    return Number.NEGATIVE_INFINITY;
  }
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function compareIdAsc(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
