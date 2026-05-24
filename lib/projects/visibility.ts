/**
 * Project visibility safety helpers.
 *
 * Public read paths (landing, gallery, project detail, sitemap) must never
 * surface a project that is not publicly visible. This module centralises the
 * predicate so every caller agrees on what "publicly visible" means and so
 * that draft and missing projects are indistinguishable to Visitors.
 *
 * A project is publicly visible when:
 *   1. `status === "published"`, AND
 *   2. `publishedAt` is set (non-null), AND
 *   3. `publishedAt` is at or before the current instant from the injected
 *      `Clock`. This guards against a future-dated `publishedAt` (e.g. a
 *      scheduled publish) leaking before its release time.
 *
 * Pure given the clock: with the same `Project` and the same `Clock.now()`
 * value, the result is deterministic, which makes these helpers safe to drive
 * from property-based tests.
 *
 * Spec references:
 * - Requirement 3.10 — 404 response is byte-identical for missing and draft
 *   projects so unpublished slugs are not enumerable.
 * - Requirement 8.7 — draft projects must not appear in gallery, landing, or
 *   any direct detail URL.
 * - Requirement 8.8 — deleted projects must not be readable.
 * - Design "Property 8: Project visibility safety" — every public read
 *   function returns NULL/excludes any project whose `status !== "published"`.
 * - Design `ContentApi.getProjectBySlug` returns NULL when slug is unknown OR
 *   the project is in `draft` status.
 */

import { systemClock, type Clock } from "@/lib/clock";
import type { Project, Slug } from "@/lib/types/domain";

/**
 * True iff `project` should be visible to Visitors right now.
 *
 * @param project   The project to evaluate.
 * @param clock     Time source; defaults to {@link systemClock}. Inject a
 *                  fixed clock in tests for determinism.
 */
export function isPubliclyVisible(project: Project, clock: Clock = systemClock): boolean {
  if (project.status !== "published") {
    return false;
  }
  if (project.publishedAt === null) {
    return false;
  }

  const publishedAtMs = Date.parse(project.publishedAt);
  // Defensively reject malformed timestamps rather than treating them as 1970.
  if (Number.isNaN(publishedAtMs)) {
    return false;
  }

  return publishedAtMs <= clock.now().getTime();
}

/**
 * Pass `project` through when it is publicly visible; otherwise return `null`.
 *
 * Designed for the `ContentApi.getProjectBySlug` shape: the caller can do a
 * single repository lookup that may return a draft (or nothing), and this
 * helper collapses both "not found" and "found but not visible" into the same
 * `null` result so the two are indistinguishable to the public surface.
 *
 * @example
 *   const project = await repo.findBySlug(slug);
 *   return assertVisibleOrNull(project);
 */
export function assertVisibleOrNull(
  project: Project | null,
  clock: Clock = systemClock,
): Project | null {
  if (project === null) {
    return null;
  }
  return isPubliclyVisible(project, clock) ? project : null;
}

/**
 * Filter a list of projects down to the ones that are publicly visible at
 * `clock.now()`. Order is preserved relative to the input.
 *
 * Use this from `listGallery`, `selectLandingFeatured`, and `buildSitemap`
 * before any further filtering, sorting, or paging so unpublished projects
 * cannot leak through any code path.
 */
export function filterPublic(
  projects: ReadonlyArray<Project>,
  clock: Clock = systemClock,
): ReadonlyArray<Project> {
  return projects.filter((project) => isPubliclyVisible(project, clock));
}

/**
 * Look up a project by slug from an in-memory list, returning `null` when the
 * slug is unknown or the matching project is not publicly visible.
 *
 * Slug comparison is exact (case-sensitive) because slugs are normalised at
 * write time to `^[a-z0-9]+(-[a-z0-9]+)*$`.
 */
export function getProjectBySlug(
  projects: ReadonlyArray<Project>,
  slug: Slug | string,
  clock: Clock = systemClock,
): Project | null {
  const match = projects.find((project) => project.slug === slug) ?? null;
  return assertVisibleOrNull(match, clock);
}
