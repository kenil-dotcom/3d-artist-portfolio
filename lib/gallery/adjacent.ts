/**
 * Adjacent project navigation for the Project_Detail_Page (Requirement 3.9).
 *
 * The Project_Detail_Page renders "previous Project" and "next Project"
 * controls that walk the published catalogue ordered by publication recency.
 * The semantics, fixed by Requirement 3.9 and "Property 7: Adjacent project
 * navigation" in the design document, are:
 *
 *   - The catalogue is ordered by `publishedAt` DESCENDING (newest first).
 *   - "previous" moves toward MORE-recently-published work (smaller index).
 *   - "next" moves toward OLDER work (larger index).
 *   - The most recently published project has no `previous` (returned as
 *     `null`) so the control renders disabled at the top endpoint.
 *   - The oldest published project has no `next` (returned as `null`) so the
 *     control renders disabled at the bottom endpoint.
 *
 * Unlike `lib/projects/navigation.getAdjacentProjects`, which accepts the
 * full catalogue and filters drafts itself, this entry point assumes the
 * caller has already restricted the input to publicly visible projects via
 * `lib/projects/visibility.filterPublic`. It is therefore named after the
 * gallery surface that feeds it — the Gallery's published list — rather than
 * the project surface that consumes it.
 *
 * Purity: this function reads no globals, performs no I/O, and does not
 * mutate its inputs. Given the same `(allPublished, currentId)` it returns
 * the same result, which makes it safe to drive from property-based tests.
 *
 * Spec references:
 * - Requirement 3.9 — visible prev/next controls disabled at the endpoints
 *   of the publication-date-descending list.
 * - Design "Property 7: Adjacent project navigation" — for the published
 *   list ordered by `publishedAt` desc, `previous = list[i - 1]` (else NULL)
 *   and `next = list[i + 1]` (else NULL).
 */

import type { Project, ProjectId } from "@/lib/types/domain";

/**
 * Result of an adjacency lookup for the Project_Detail_Page navigation.
 *
 * Both fields hold full {@link Project} records (not just ids) so the page
 * can build prev/next links without a second repository lookup. They are
 * independently `null` when the current project sits at the corresponding
 * endpoint of the published catalogue, or when `currentId` is not present
 * in `allPublished` at all.
 */
export interface AdjacentProjects {
  /**
   * The project published immediately AFTER `currentId` (more recent work).
   * `null` when `currentId` is the most-recently-published project, or when
   * `currentId` is not in `allPublished`.
   */
  readonly previous: Project | null;
  /**
   * The project published immediately BEFORE `currentId` (older work).
   * `null` when `currentId` is the oldest published project, or when
   * `currentId` is not in `allPublished`.
   */
  readonly next: Project | null;
}

/**
 * Order published projects newest-first with a stable tie-break.
 *
 * Sort key: `publishedAt` descending, then `id` ascending. The id tie-break
 * keeps ordering deterministic across machines and across calls when two
 * projects share an exact publication timestamp, which is what Property 7
 * relies on to reason about indexed positions.
 *
 * Defensive null-handling: `allPublished` is contractually filtered to
 * publicly visible projects (which always have a non-null `publishedAt`),
 * but if a malformed entry slips through we treat its `publishedAt` as
 * `-Infinity` so it sorts to the end of the list rather than poisoning the
 * comparison with `NaN`.
 *
 * The returned array is a fresh array; the input is not mutated.
 */
function sortByPublishedAtDesc(projects: ReadonlyArray<Project>): Project[] {
  return projects.slice().sort((a, b) => {
    const aMs = a.publishedAt === null ? -Infinity : Date.parse(a.publishedAt);
    const bMs = b.publishedAt === null ? -Infinity : Date.parse(b.publishedAt);
    const aSafe = Number.isNaN(aMs) ? -Infinity : aMs;
    const bSafe = Number.isNaN(bMs) ? -Infinity : bMs;

    if (aSafe !== bSafe) {
      // Descending by publication time: newer (larger ms) first.
      return bSafe - aSafe;
    }

    // Tie-break by id ascending so the order is total and deterministic.
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/**
 * Look up the projects adjacent to `currentId` within the publicly visible
 * catalogue, ordered by `publishedAt` descending.
 *
 * Behaviour:
 *   1. Sort `allPublished` by `publishedAt` descending (newest first), with
 *      ties broken by `id` ascending so the order is deterministic.
 *   2. Locate `currentId`'s index `i` in that sorted list.
 *      - If `currentId` is not in the list, return
 *        `{ previous: null, next: null }`. Callers should already have
 *        produced a 404 in that case (Requirement 3.10); we simply refuse
 *        to invent neighbours.
 *      - Otherwise, `previous = sorted[i - 1] ?? null` and
 *        `next = sorted[i + 1] ?? null`.
 *
 * The caller is responsible for restricting `allPublished` to publicly
 * visible projects (see `lib/projects/visibility.filterPublic`). This
 * function does not re-check `status`, which keeps it free of clock
 * dependencies and trivially testable.
 *
 * @param allPublished  Publicly visible projects, in any order. Not mutated.
 * @param currentId     The id of the project whose neighbours we want.
 */
export function findAdjacentProjects(
  allPublished: ReadonlyArray<Project>,
  currentId: ProjectId,
): AdjacentProjects {
  const sorted = sortByPublishedAtDesc(allPublished);

  const currentIndex = sorted.findIndex((project) => project.id === currentId);
  if (currentIndex === -1) {
    return { previous: null, next: null };
  }

  // `currentIndex - 1` is the project published more recently than the
  // current one (the "previous" link toward newer work); `currentIndex + 1`
  // is the next-older project (the "next" link toward older work).
  const previous = currentIndex > 0 ? (sorted[currentIndex - 1] ?? null) : null;
  const next =
    currentIndex < sorted.length - 1 ? (sorted[currentIndex + 1] ?? null) : null;

  return { previous, next };
}
