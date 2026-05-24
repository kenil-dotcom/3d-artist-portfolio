/**
 * Adjacent project navigation.
 *
 * The Project_Detail_Page renders "previous Project" and "next Project"
 * controls (Requirement 3.9). These walk the public catalogue ordered by
 * publication recency:
 *
 *   - "previous" moves toward MORE-recently-published work (smaller index in
 *     the publication-date-descending list).
 *   - "next" moves toward OLDER work (larger index).
 *
 * Disabled-state semantics fall out of `null` results: the most recent
 * project has no `previous`, and the oldest has no `next`. Callers translate
 * `null` into the disabled control per Requirement 3.9.
 *
 * Spec references:
 * - Requirement 3.9 — visible prev/next controls disabled at the endpoints
 *   of the publication-date-descending list.
 * - Design "Property 7: Adjacent project navigation" — for the published list
 *   ordered by `publishedAt` desc, `prev = projects[i - 1]` (else NULL) and
 *   `next = projects[i + 1]` (else NULL).
 *
 * Purity: this function reads no globals, performs no I/O, and depends only
 * on its arguments. Given the same `(allProjects, currentId)` it returns the
 * same result, which makes it safe to drive from property-based tests.
 */

import type { Project, ProjectId } from "@/lib/types/domain";

/**
 * Result of an adjacency lookup.
 *
 * `previous` and `next` are full {@link Project} records (not just ids) so
 * callers can build links without a second lookup. They are independently
 * `null` when the current project sits at the corresponding endpoint of the
 * published catalogue, or when the current id is unknown.
 */
export interface AdjacentProjects {
  /**
   * The project published immediately AFTER `currentId` (more recent work).
   * `null` when `currentId` is the most-recently-published project, or when
   * `currentId` is not in the published catalogue.
   */
  readonly previous: Project | null;
  /**
   * The project published immediately BEFORE `currentId` (older work).
   * `null` when `currentId` is the oldest published project, or when
   * `currentId` is not in the published catalogue.
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
 * The returned array is a fresh array; the input is not mutated.
 */
function sortPublishedDesc(projects: ReadonlyArray<Project>): Project[] {
  return projects.slice().sort((a, b) => {
    // `publishedAt` is non-null here because the caller has already filtered
    // out projects without a publication timestamp.
    const aMs = Date.parse(a.publishedAt as unknown as string);
    const bMs = Date.parse(b.publishedAt as unknown as string);

    if (aMs !== bMs) {
      // Descending by publication time: newer first.
      return bMs - aMs;
    }

    // Tie-break by id ascending so the order is total and deterministic.
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
}

/**
 * Look up the projects adjacent to `currentId` in the public, publication-
 * date-descending catalogue.
 *
 * Behaviour:
 *  1. Filter `allProjects` to entries with `status === "published"` and a
 *     non-null `publishedAt`. Drafts and never-published projects are
 *     invisible to this function so it can never link to them.
 *  2. Sort the survivors by `publishedAt` descending, breaking ties by `id`
 *     ascending so the order is deterministic.
 *  3. Locate `currentId`'s index `i` in that sorted list.
 *      - If `currentId` is not in the published list (unknown, draft, or
 *        deleted), return `{ previous: null, next: null }`. Callers should
 *        already have produced a 404 in that case; we simply refuse to
 *        invent neighbours.
 *      - Otherwise, `previous = sorted[i - 1] ?? null` and
 *        `next = sorted[i + 1] ?? null`.
 *
 * @param allProjects  The full project catalogue (any status). Not mutated.
 * @param currentId    The id of the project whose neighbours we want.
 */
export function getAdjacentProjects(
  allProjects: ReadonlyArray<Project>,
  currentId: ProjectId,
): AdjacentProjects {
  const published = allProjects.filter(
    (project) => project.status === "published" && project.publishedAt !== null,
  );

  const sorted = sortPublishedDesc(published);

  const currentIndex = sorted.findIndex((project) => project.id === currentId);
  if (currentIndex === -1) {
    return { previous: null, next: null };
  }

  // `currentIndex - 1` is the project published more recently than the
  // current one; `currentIndex + 1` is the next-older project.
  const previous = currentIndex > 0 ? (sorted[currentIndex - 1] ?? null) : null;
  const next = currentIndex < sorted.length - 1 ? (sorted[currentIndex + 1] ?? null) : null;

  return { previous, next };
}
