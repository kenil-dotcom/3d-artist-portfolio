/**
 * Adjacent project navigation for the Project_Detail_Page (Requirement 3.9).
 *
 * The Project_Detail_Page renders "previous Project" and "next Project"
 * controls that walk the published catalogue ordered by publication
 * recency. The semantics, fixed by Requirement 3.9 and "Property 7:
 * Adjacent project navigation" in the design document, are:
 *
 *   - The catalogue is ordered by `publishedAt` DESCENDING (newest first).
 *   - `prev` moves toward MORE-recently-published work (smaller index in
 *     the sorted list).
 *   - `next` moves toward OLDER work (larger index in the sorted list).
 *   - The most-recently-published project has no `prev` (returned as
 *     `null`); the oldest published project has no `next` (also `null`).
 *     Callers translate `null` into a disabled control per Requirement 3.9.
 *
 * Inputs: this function expects `publishedProjects` to be the publicly
 * visible catalogue — i.e. already filtered through
 * `lib/projects/visibility.filterPublic` so every entry has
 * `status === "published"` and a non-null `publishedAt`. The function does
 * not re-check `status`, which keeps it free of clock dependencies and
 * trivially testable. Order of the input is irrelevant: the function sorts
 * defensively so callers cannot accidentally hand in a list that was sorted
 * by something else (e.g. title).
 *
 * Lookup is by `slug` rather than by id because the Project_Detail_Page
 * route is keyed on slug (`/projects/[slug]`), so the caller already has
 * the slug in hand and does not need to resolve it to an id first.
 *
 * Purity: this function reads no globals, performs no I/O, and does not
 * mutate its inputs. Given the same `(publishedProjects, slug)` it returns
 * the same result, which makes it safe to drive from property-based tests.
 *
 * Spec references:
 *  - Requirement 3.9 — visible prev/next controls disabled at the endpoints
 *    of the publication-date-descending list.
 *  - Design "Property 7: Adjacent project navigation" — for the published
 *    list ordered by `publishedAt` desc, `prev = projects[i - 1]` (else
 *    NULL) and `next = projects[i + 1]` (else NULL).
 */

import type { Project, Slug } from "@/lib/types/domain";

/**
 * Result of an adjacency lookup for the Project_Detail_Page navigation.
 *
 * Both fields hold full {@link Project} records (not just slugs/ids) so
 * the page can build the prev/next link tiles — title, cover image,
 * etc. — without a second repository lookup. They are independently
 * `null` when the current project sits at the corresponding endpoint of
 * the published catalogue, or when `slug` is not present in
 * `publishedProjects` at all.
 */
export interface AdjacentProjects {
  /**
   * The project published immediately AFTER the current one (more recent
   * work). `null` when the current project is the most-recently-published
   * project, or when `slug` is not in `publishedProjects`.
   */
  readonly prev: Project | null;
  /**
   * The project published immediately BEFORE the current one (older work).
   * `null` when the current project is the oldest published project, or
   * when `slug` is not in `publishedProjects`.
   */
  readonly next: Project | null;
}

/**
 * Order published projects newest-first with a stable tie-break.
 *
 * Sort key: `publishedAt` descending, then `slug` ascending. The slug
 * tie-break keeps ordering deterministic across machines and across calls
 * when two projects share an exact publication timestamp, which is what
 * Property 7 relies on to reason about indexed positions. Slugs are
 * globally unique (Requirement 8.2 / design schema), so this is a total
 * order on the published catalogue.
 *
 * Defensive null-handling: `publishedProjects` is contractually filtered
 * to publicly visible projects (which always have a non-null
 * `publishedAt`), but if a malformed entry slips through we treat its
 * `publishedAt` as `-Infinity` so it sorts to the end of the list rather
 * than poisoning the comparison with `NaN`.
 *
 * The returned array is a fresh array; the input is not mutated.
 */
function sortByPublishedAtDesc(projects: ReadonlyArray<Project>): Project[] {
  return projects.slice().sort((a, b) => {
    const aMs =
      a.publishedAt === null
        ? Number.NEGATIVE_INFINITY
        : Date.parse(a.publishedAt);
    const bMs =
      b.publishedAt === null
        ? Number.NEGATIVE_INFINITY
        : Date.parse(b.publishedAt);
    const aSafe = Number.isNaN(aMs) ? Number.NEGATIVE_INFINITY : aMs;
    const bSafe = Number.isNaN(bMs) ? Number.NEGATIVE_INFINITY : bMs;

    if (aSafe !== bSafe) {
      // Descending by publication time: newer (larger ms) first.
      return bSafe - aSafe;
    }

    // Tie-break by slug ascending so the order is total and deterministic.
    if (a.slug < b.slug) return -1;
    if (a.slug > b.slug) return 1;
    return 0;
  });
}

/**
 * Look up the projects adjacent to `slug` within the publicly visible
 * catalogue, ordered by `publishedAt` descending.
 *
 * Behaviour:
 *  1. Sort `publishedProjects` by `publishedAt` descending (newest first),
 *     with ties broken by `slug` ascending so the order is deterministic.
 *  2. Locate `slug`'s index `i` in the sorted list.
 *      - If `slug` is not in the list (unknown, draft, or deleted), return
 *        `{ prev: null, next: null }`. Callers should already have produced
 *        a 404 in that case (Requirement 3.10); we simply refuse to invent
 *        neighbours.
 *      - Otherwise, `prev = sorted[i - 1] ?? null` and
 *        `next = sorted[i + 1] ?? null`.
 *
 * Disabled-state semantics (Requirement 3.9) fall out of `null` results:
 * the most-recently-published project has no `prev`, and the oldest
 * published project has no `next`. The caller renders the corresponding
 * control disabled when the field is `null`.
 *
 * @param publishedProjects  Publicly visible projects, in any order. Not
 *                           mutated. Drafts must already be filtered out by
 *                           the caller (e.g. via
 *                           `lib/projects/visibility.filterPublic`); this
 *                           function trusts the caller's filter.
 * @param slug               Slug of the current Project_Detail_Page.
 */
export function getAdjacentProjects(
  publishedProjects: ReadonlyArray<Project>,
  slug: Slug | string,
): AdjacentProjects {
  const sorted = sortByPublishedAtDesc(publishedProjects);

  const currentIndex = sorted.findIndex((project) => project.slug === slug);
  if (currentIndex === -1) {
    return { prev: null, next: null };
  }

  // `currentIndex - 1` is the project published more recently than the
  // current one (the "prev" link toward newer work); `currentIndex + 1`
  // is the next-older project (the "next" link toward older work).
  const prev =
    currentIndex > 0 ? (sorted[currentIndex - 1] ?? null) : null;
  const next =
    currentIndex < sorted.length - 1
      ? (sorted[currentIndex + 1] ?? null)
      : null;

  return { prev, next };
}
