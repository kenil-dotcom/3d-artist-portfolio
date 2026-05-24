/**
 * Pure gallery listing logic: filter, sort, and paginate a `Project` list
 * for the public Gallery (Requirement 2 and 8.7).
 *
 * This module performs no I/O. The DB-backed adapter is introduced in a
 * later task and delegates to `listGallery` after loading the candidate
 * `Project[]` from Postgres.
 *
 * Key invariants (mirroring design.md "Property 3: Gallery filter, sort,
 * and pagination"):
 *
 * - Only `status = "published"` projects are considered.
 * - `query.category` (when non-null) and `query.tags` (conjunctive ALL,
 *   treated as a set) restrict the candidate list further.
 * - Sort orders:
 *     `newest`     -> publishedAt descending
 *     `oldest`     -> publishedAt ascending
 *     `title_asc`  -> title ascending under locale-insensitive,
 *                     case-insensitive compare
 *   Ties are broken deterministically: title_asc by publishedAt desc then
 *   id ascending; newest/oldest by id ascending.
 * - Page size is fixed at 24.
 * - `totalPages = max(1, ceil(totalCount / 24))`, so an empty result still
 *   has `totalPages = 1`.
 * - When the requested page is outside `[1, totalPages]`, the result
 *   collapses to page 1 with `outOfRange = true` (Requirement 2.10).
 * - The result is invariant under reordering of `query.tags` (set
 *   semantics, not list).
 */

import type { GalleryPageResult, GalleryQuery, GallerySort } from "@/lib/types/cms";
import type { Project } from "@/lib/types/domain";

/**
 * Number of projects shown per Gallery page (Requirement 2.6).
 */
export const GALLERY_PAGE_SIZE = 24;

/**
 * Filter, sort, and paginate `projects` for the public Gallery view.
 *
 * Pure: returns a fresh `GalleryPageResult` and never mutates the inputs.
 */
export function listGallery(
  projects: ReadonlyArray<Project>,
  query: GalleryQuery,
): GalleryPageResult {
  // 1. Public visibility (Requirement 8.7): only published projects.
  let candidates = projects.filter((p) => p.status === "published");

  // 2. Category filter (single, optional).
  if (query.category !== null) {
    const wanted = query.category;
    candidates = candidates.filter((p) => p.categoryId === wanted);
  }

  // 3. Tag filter (conjunctive ALL, set semantics: invariant to ordering).
  if (query.tags.length > 0) {
    const required = new Set<string>(query.tags as ReadonlyArray<string>);
    candidates = candidates.filter((p) => {
      const have = new Set<string>(p.tagIds as ReadonlyArray<string>);
      for (const tag of required) {
        if (!have.has(tag)) return false;
      }
      return true;
    });
  }

  // 4. Sort. Take a shallow copy so the caller's array is left untouched.
  const sorted = candidates.slice().sort((a, b) => compareProjects(a, b, query.sort));

  // 5. Pagination.
  const totalCount = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / GALLERY_PAGE_SIZE));

  const requestedPage = query.page;
  const inRange = requestedPage >= 1 && requestedPage <= totalPages;
  const page = inRange ? requestedPage : 1;
  const outOfRange = !inRange;

  const start = (page - 1) * GALLERY_PAGE_SIZE;
  const items = sorted.slice(start, start + GALLERY_PAGE_SIZE);

  return {
    items,
    page,
    totalPages,
    totalCount,
    outOfRange,
  };
}

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

function compareProjects(a: Project, b: Project, sort: GallerySort): number {
  switch (sort) {
    case "newest": {
      const c = compareTimestampDesc(a.publishedAt, b.publishedAt);
      return c !== 0 ? c : compareStringAsc(a.id, b.id);
    }
    case "oldest": {
      const c = compareTimestampAsc(a.publishedAt, b.publishedAt);
      return c !== 0 ? c : compareStringAsc(a.id, b.id);
    }
    case "title_asc": {
      const t = compareTitleCaseInsensitive(a.title, b.title);
      if (t !== 0) return t;
      const p = compareTimestampDesc(a.publishedAt, b.publishedAt);
      if (p !== 0) return p;
      return compareStringAsc(a.id, b.id);
    }
  }
}

/**
 * Lexicographic ascending compare on two strings. ISO-8601 timestamps and
 * branded ids are both safe to compare this way: they are deterministic
 * and locale-insensitive.
 */
function compareStringAsc(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Compare two nullable ISO timestamps in ascending order. `null` sorts
 * lower than any real timestamp; in practice published projects always
 * have a `publishedAt`, so the null-handling is purely defensive.
 */
function compareTimestampAsc(a: string | null, b: string | null): number {
  const av = a ?? "";
  const bv = b ?? "";
  return compareStringAsc(av, bv);
}

function compareTimestampDesc(a: string | null, b: string | null): number {
  return -compareTimestampAsc(a, b);
}

/**
 * Locale-insensitive, case-insensitive title comparison. Uses byte-wise
 * compare on lowercased strings rather than `localeCompare` so the order
 * is stable across runtimes and locales.
 */
function compareTitleCaseInsensitive(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  return compareStringAsc(al, bl);
}
