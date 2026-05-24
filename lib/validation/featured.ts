/**
 * Featured set validator.
 *
 * Pure validation for the Admin "featured projects" list shown on the
 * landing page. The CMS may designate between 0 and 12 published projects
 * as featured, in a specific display order (Requirement 8.10). The
 * `featuredOrder` per project is the project's 0-based index in that
 * ordered list (see design.md "Validation rules").
 *
 * The validator is the single source of truth used by both the Zod schema
 * powering the CMS form and the `setFeaturedProjects` server action; it
 * returns the complete list of `FieldError`s rather than throwing or
 * short-circuiting so the UI can highlight every offending entry in one
 * pass.
 *
 * The function is pure: no I/O, no clock, no global state. Callers inject
 * the set of currently-known and currently-published project ids; the
 * validator never reaches out to the database itself.
 *
 * Spec references:
 *   - Requirement 8.10
 *   - design.md "Property 19: Featured set bounds and uniqueness"
 */

import type { ProjectId } from '@/lib/types/domain';
import type { FieldError } from '@/lib/types/inquiry';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Maximum number of featured projects (Requirement 8.10). */
export const FEATURED_MAX = 12;

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

/**
 * Stable error codes surfaced to the CMS for failed featured-set saves.
 * Kept narrow so the UI can branch deterministically and so property tests
 * can assert exhaustive coverage of violation kinds.
 *
 *   - `too_many`            — `orderedIds.length > 12`
 *   - `duplicate`           — a project id appears more than once
 *   - `unknown_project`     — id is not present in the known-projects set
 *   - `unpublished_project` — id is known but its project is not published
 */
export type FeaturedErrorCode =
  | 'too_many'
  | 'duplicate'
  | 'unknown_project'
  | 'unpublished_project';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Sets injected by the caller so the validator can distinguish "id does
 * not refer to any project at all" from "id refers to a draft project".
 *
 *   - `knownProjectIds` enumerates every `ProjectId` currently in the
 *     database (regardless of status).
 *   - `publishedProjectIds` is its subset whose project `status` is
 *     `"published"`.
 *
 * The validator does not assume `publishedProjectIds ⊆ knownProjectIds`
 * (a defensive caller may pass disjoint sets); membership is checked
 * independently against each set.
 */
export interface FeaturedValidationContext {
  readonly knownProjectIds: ReadonlySet<ProjectId>;
  readonly publishedProjectIds: ReadonlySet<ProjectId>;
}

/**
 * Discriminated result of {@link validateFeaturedIds}.
 *
 * On success the caller may apply `featuredOrder = index` for each id in
 * `orderedIds` transactionally; on failure `errors` enumerates every
 * violation (no short-circuiting) so the CMS can surface them all at once.
 */
export type FeaturedValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: ReadonlyArray<FieldError> };

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate an ordered list of project ids intended to become the featured
 * set on the landing page (Requirement 8.10).
 *
 * Rules (all enforced; all violations reported):
 *
 * 1. `0 ≤ orderedIds.length ≤ 12`. Beyond 12, a single `too_many` error is
 *    pinned to the `featured` field (the issue is the list as a whole, not
 *    any specific entry).
 * 2. No id appears more than once. Each duplicate occurrence after the
 *    first emits a `duplicate` error pinned to its index.
 * 3. Every id is present in `ctx.knownProjectIds`. Otherwise an
 *    `unknown_project` error is pinned to its index.
 * 4. Every known id is also present in `ctx.publishedProjectIds`. Known
 *    but draft projects emit an `unpublished_project` error pinned to
 *    their index. Unknown ids do not also emit `unpublished_project`
 *    (the two codes are mutually exclusive at any given index).
 *
 * The function is pure: it neither mutates inputs nor performs I/O.
 *
 * @param orderedIds Ordered project ids the Admin selected as featured.
 * @param ctx        Membership context injected by the caller.
 */
export function validateFeaturedIds(
  orderedIds: ReadonlyArray<ProjectId>,
  ctx: FeaturedValidationContext,
): FeaturedValidationResult {
  const errors: FieldError[] = [];

  // Rule 1: list-level length cap. We still iterate the rest of the list so
  // duplicates and membership errors are also reported in the same pass.
  if (orderedIds.length > FEATURED_MAX) {
    errors.push({
      field: 'featured',
      code: 'too_many',
      message: `Up to ${FEATURED_MAX} featured projects are allowed; received ${orderedIds.length}.`,
    });
  }

  // Track first-seen indices so duplicate errors point at the duplicate
  // occurrence rather than the original.
  const firstSeenAt = new Map<ProjectId, number>();

  for (let index = 0; index < orderedIds.length; index++) {
    // `noUncheckedIndexedAccess` makes this `ProjectId | undefined`; the
    // bounds of the loop guarantee a value is present.
    const id = orderedIds[index] as ProjectId;
    const field = `featured[${index}]`;

    // Rule 2: duplicates. Reported once per duplicate occurrence (i.e. the
    // 2nd and later appearances of an id). Duplicate detection is
    // independent of membership so a duplicated *and* unknown id surfaces
    // both violations in one pass.
    if (firstSeenAt.has(id)) {
      errors.push({
        field,
        code: 'duplicate',
        message: `Project ${id} appears more than once in the featured list.`,
      });
    } else {
      firstSeenAt.set(id, index);
    }

    // Rules 3 & 4: membership. `unknown_project` and `unpublished_project`
    // are mutually exclusive at a given index — an id that is not even
    // known cannot meaningfully be reported as "unpublished".
    if (!ctx.knownProjectIds.has(id)) {
      errors.push({
        field,
        code: 'unknown_project',
        message: `Project ${id} does not exist.`,
      });
    } else if (!ctx.publishedProjectIds.has(id)) {
      errors.push({
        field,
        code: 'unpublished_project',
        message: `Project ${id} is not published.`,
      });
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true };
}
