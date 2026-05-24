/**
 * Project input and publish-readiness validators.
 *
 * Pure functions used by the CMS write paths and exercised by Property 16
 * in `design.md`. They have no I/O dependencies; the "today" boundary is
 * supplied by the caller (Date or `Clock.now()`) so tests can drive time
 * deterministically.
 *
 * Spec references:
 * - Requirement 8.2  (project input bounds)
 * - Requirement 8.11 (publish rejected when title / cover / media missing,
 *   listing every missing element individually)
 * - Requirement 10.4 (image media without alt text cannot be published)
 *
 * Design references:
 * - "Validation rules" subsection of the Inquiry models block.
 * - Property 16 ("Project input and publish-readiness validation").
 */

import type {
  MediaItem,
  Project,
  ProjectStatus,
} from '@/lib/types/domain';
import type { ProjectInput } from '@/lib/types/cms';
import type { FieldError } from '@/lib/types/inquiry';

// ---------------------------------------------------------------------------
// Bounds (kept as named constants so tests can reference them by name).
// ---------------------------------------------------------------------------

export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 5000;
export const TAG_IDS_MAX = 20;
export const SOFTWARE_USED_MAX = 20;
export const SOFTWARE_ENTRY_MIN_LENGTH = 1;
export const SOFTWARE_ENTRY_MAX_LENGTH = 60;
export const SLUG_MAX_LENGTH = 80;
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const VALID_STATUSES: ReadonlySet<ProjectStatus> = new Set(['draft', 'published']);

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

/**
 * Result of `validateProjectInput`. `errors` is empty iff `ok` is true; on
 * failure every violated rule is reported as a `FieldError` with a stable
 * machine-readable `code`.
 */
export type ProjectInputValidationResult =
  | { readonly ok: true; readonly errors: readonly [] }
  | { readonly ok: false; readonly errors: ReadonlyArray<FieldError> };

/**
 * Result of `validatePublishable`. On failure, `missing` enumerates every
 * obstacle to publication individually so the CMS can surface them all at
 * once (Requirement 8.11). Image media items without alt text appear as
 * `missing_alt_text(<mediaId>)` per Requirement 10.4.
 */
export type PublishableValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly missing: ReadonlyArray<string> };

// ---------------------------------------------------------------------------
// Slug
// ---------------------------------------------------------------------------

/**
 * Returns `true` iff `s` is a valid project slug.
 *
 * A valid slug matches `^[a-z0-9]+(-[a-z0-9]+)*$` (lower-case alphanumerics
 * separated by single hyphens, never starting or ending with a hyphen) and
 * has length 1..80.
 */
export function validateSlug(s: string): boolean {
  if (typeof s !== 'string') {
    return false;
  }
  if (s.length < 1 || s.length > SLUG_MAX_LENGTH) {
    return false;
  }
  return SLUG_PATTERN.test(s);
}

// ---------------------------------------------------------------------------
// Project input
// ---------------------------------------------------------------------------

/**
 * Validate a `ProjectInput` payload at the CMS write boundary.
 *
 * Succeeds iff every clause from Property 16 holds:
 *   - `1 ≤ len(title) ≤ 120`
 *   - `0 ≤ len(description) ≤ 5000`
 *   - exactly one (non-empty) `categoryId`
 *   - `0 ≤ |tagIds| ≤ 20` and tag ids are unique
 *   - `0 ≤ |softwareUsed| ≤ 20` with each entry `1..60` chars
 *   - `creationDate ≤ today` (UTC calendar-day comparison)
 *   - `status ∈ {"draft", "published"}`
 *
 * The `today` boundary is supplied by the caller (e.g. `clock.now()`) so the
 * function remains pure and deterministic.
 */
export function validateProjectInput(
  input: ProjectInput,
  today: Date
): ProjectInputValidationResult {
  const errors: FieldError[] = [];

  // --- title -------------------------------------------------------------
  const title = input.title ?? '';
  if (title.length < TITLE_MIN_LENGTH) {
    errors.push({
      field: 'title',
      code: 'length_min',
      message: `title must be at least ${TITLE_MIN_LENGTH} character(s)`,
    });
  } else if (title.length > TITLE_MAX_LENGTH) {
    errors.push({
      field: 'title',
      code: 'length_max',
      message: `title must be at most ${TITLE_MAX_LENGTH} characters`,
    });
  }

  // --- description -------------------------------------------------------
  const description = input.description ?? '';
  if (description.length > DESCRIPTION_MAX_LENGTH) {
    errors.push({
      field: 'description',
      code: 'length_max',
      message: `description must be at most ${DESCRIPTION_MAX_LENGTH} characters`,
    });
  }

  // --- category ----------------------------------------------------------
  if (typeof input.categoryId !== 'string' || input.categoryId.length === 0) {
    errors.push({
      field: 'categoryId',
      code: 'required',
      message: 'exactly one category is required',
    });
  }

  // --- tagIds ------------------------------------------------------------
  const tagIds = input.tagIds ?? [];
  if (tagIds.length > TAG_IDS_MAX) {
    errors.push({
      field: 'tagIds',
      code: 'length_max',
      message: `tagIds must contain at most ${TAG_IDS_MAX} entries`,
    });
  }
  const seenTagIds = new Set<string>();
  for (let i = 0; i < tagIds.length; i++) {
    const tagId = tagIds[i] as string;
    if (seenTagIds.has(tagId)) {
      errors.push({
        field: `tagIds[${i}]`,
        code: 'duplicate',
        message: 'tagIds must not contain duplicates',
      });
    } else {
      seenTagIds.add(tagId);
    }
  }

  // --- softwareUsed ------------------------------------------------------
  const softwareUsed = input.softwareUsed ?? [];
  if (softwareUsed.length > SOFTWARE_USED_MAX) {
    errors.push({
      field: 'softwareUsed',
      code: 'length_max',
      message: `softwareUsed must contain at most ${SOFTWARE_USED_MAX} entries`,
    });
  }
  for (let i = 0; i < softwareUsed.length; i++) {
    const entry = softwareUsed[i] ?? '';
    if (entry.length < SOFTWARE_ENTRY_MIN_LENGTH) {
      errors.push({
        field: `softwareUsed[${i}]`,
        code: 'length_min',
        message: `softwareUsed entries must be at least ${SOFTWARE_ENTRY_MIN_LENGTH} character(s)`,
      });
    } else if (entry.length > SOFTWARE_ENTRY_MAX_LENGTH) {
      errors.push({
        field: `softwareUsed[${i}]`,
        code: 'length_max',
        message: `softwareUsed entries must be at most ${SOFTWARE_ENTRY_MAX_LENGTH} characters`,
      });
    }
  }

  // --- creationDate ------------------------------------------------------
  const creationDate = input.creationDate;
  if (typeof creationDate !== 'string' || creationDate.length === 0) {
    errors.push({
      field: 'creationDate',
      code: 'required',
      message: 'creationDate is required',
    });
  } else if (!isValidIsoCalendarDay(creationDate)) {
    errors.push({
      field: 'creationDate',
      code: 'date_invalid',
      message: 'creationDate must be a valid YYYY-MM-DD calendar date',
    });
  } else if (compareIsoDays(creationDate, toIsoCalendarDay(today)) > 0) {
    errors.push({
      field: 'creationDate',
      code: 'date_in_future',
      message: 'creationDate must be on or before today',
    });
  }

  // --- status ------------------------------------------------------------
  if (!VALID_STATUSES.has(input.status as ProjectStatus)) {
    errors.push({
      field: 'status',
      code: 'enum_invalid',
      message: 'status must be one of: draft, published',
    });
  }

  if (errors.length === 0) {
    return { ok: true, errors: [] };
  }
  return { ok: false, errors };
}

// ---------------------------------------------------------------------------
// Publish readiness
// ---------------------------------------------------------------------------

/**
 * Validate that a persisted `Project` is ready to be published.
 *
 * Returns `{ ok: true }` when every gate passes. Otherwise returns the
 * complete enumeration of obstacles so the CMS can show them to the Admin
 * at once (Requirement 8.11):
 *
 *   - `missing_title`            (`title` is empty/whitespace)
 *   - `missing_cover_media`      (`coverMediaId` is `null`)
 *   - `no_media_items`           (`mediaItems` is empty)
 *   - `missing_alt_text(<id>)`   one entry per image media item lacking
 *                                non-empty `altText` (Requirement 10.4)
 *
 * Pure function: no clock or I/O dependency.
 */
export function validatePublishable(project: Project): PublishableValidationResult {
  const missing: string[] = [];

  if (!hasNonEmptyTitle(project.title)) {
    missing.push('missing_title');
  }

  if (project.coverMediaId == null) {
    missing.push('missing_cover_media');
  }

  if (!project.mediaItems || project.mediaItems.length === 0) {
    missing.push('no_media_items');
  } else {
    for (const item of project.mediaItems) {
      if (item.kind === 'image' && !hasNonEmptyAltText(item)) {
        missing.push(`missing_alt_text(${item.id})`);
      }
    }
  }

  if (missing.length === 0) {
    return { ok: true };
  }
  return { ok: false, missing };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasNonEmptyTitle(title: unknown): boolean {
  return typeof title === 'string' && title.trim().length > 0;
}

function hasNonEmptyAltText(item: MediaItem): boolean {
  return typeof item.altText === 'string' && item.altText.trim().length > 0;
}

const ISO_DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Returns `true` iff `s` is a syntactically valid `YYYY-MM-DD` calendar day
 * that round-trips through UTC (rejects e.g. `2024-02-30`).
 */
function isValidIsoCalendarDay(s: string): boolean {
  const match = ISO_DAY_PATTERN.exec(s);
  if (match === null) {
    return false;
  }
  const yyyy = Number.parseInt(match[1] as string, 10);
  const mm = Number.parseInt(match[2] as string, 10);
  const dd = Number.parseInt(match[3] as string, 10);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return false;
  }
  const utcMs = Date.UTC(yyyy, mm - 1, dd);
  const parsed = new Date(utcMs);
  return (
    parsed.getUTCFullYear() === yyyy &&
    parsed.getUTCMonth() === mm - 1 &&
    parsed.getUTCDate() === dd
  );
}

/**
 * Project a `Date` onto its UTC calendar day in `YYYY-MM-DD` form so it can
 * be compared lexicographically against an `IsoDate`.
 */
function toIsoCalendarDay(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, '0');
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = d.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Lexicographic comparison of two `YYYY-MM-DD` strings (which matches their
 * chronological ordering). Returns `< 0`, `0`, or `> 0`.
 */
function compareIsoDays(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}
