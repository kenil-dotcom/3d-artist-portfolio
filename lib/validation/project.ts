/**
 * Project input and publish-readiness validators.
 *
 * Pure functions used by the CMS write paths and exercised by Property 16
 * in `design.md` (project input) plus the Publish_Readiness_Checklist in
 * Requirement 8 (publish-readiness aggregation). They have no I/O
 * dependencies; the "today" boundary is supplied by the caller (Date or
 * `Clock.now()`) so tests can drive time deterministically.
 *
 * Spec references:
 * - Requirement 8.1–8.9 (Publish_Readiness_Checklist; non-short-circuiting
 *   distinct union of failing codes in `RULE_ORDER`)
 * - Requirement 8.2     (project input bounds)
 * - Requirement 10.4    (image media without alt text cannot be published)
 *
 * Design references:
 * - "Publish-readiness aggregation" subsection of `design.md`
 *   ("RULE_ORDER" constant; non-short-circuiting evaluation; pure function)
 * - Property 16 ("Project input and publish-readiness validation").
 */

import type {
  MediaItem,
  Project,
  ProjectStatus,
  SectionBlock,
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
 * Stable, machine-readable codes returned by `validatePublishable` when a
 * candidate Project fails to meet the Publish_Readiness_Checklist
 * (Requirement 8.1–8.9). The order in which codes appear in `RULE_ORDER`
 * is the order in which `missing` is emitted, so callers and tests can
 * rely on a deterministic shape.
 */
export type PublishReadinessCode =
  | 'missing_title'
  | 'invalid_slug'
  | 'missing_category'
  | 'missing_cover'
  | 'no_media'
  | 'missing_alt_text'
  | 'block_reference_broken';

/**
 * Canonical evaluation order for the Publish_Readiness_Checklist. The
 * validator is non-short-circuiting: every rule is evaluated against the
 * candidate Project, the failing codes are collected into a set, and the
 * result is filtered against `RULE_ORDER` so duplicate detections collapse
 * and the output ordering is stable across calls.
 */
export const RULE_ORDER: ReadonlyArray<PublishReadinessCode> = [
  'missing_title',
  'invalid_slug',
  'missing_category',
  'missing_cover',
  'no_media',
  'missing_alt_text',
  'block_reference_broken',
];

/**
 * Result of `validatePublishable`. On failure, `missing` is the distinct,
 * `RULE_ORDER`-ordered union of failing codes so the CMS can show every
 * blocker at once (Requirement 8.9).
 */
export type PublishableValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly missing: ReadonlyArray<PublishReadinessCode>;
    };

/**
 * Result of `normalizeSoftwareList`. On failure, `code` reports which rule
 * was violated using the machine-readable identifiers from the spec
 * (Requirement 11.5 / 11.6).
 */
export type SoftwareListNormalizationResult =
  | { readonly ok: true; readonly value: ReadonlyArray<string> }
  | {
      readonly ok: false;
      readonly code: 'too_many_software_entries' | 'invalid_software_entry';
    };

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
// Software list normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a software-used list at the CMS write boundary.
 *
 * Behaviour (Requirements 11.3, 11.4, 11.5, 11.6):
 *   - Each entry is trimmed.
 *   - Any entry whose trimmed length is 0 or > {@link SOFTWARE_ENTRY_MAX_LENGTH}
 *     causes the whole call to reject with `invalid_software_entry`.
 *   - Duplicates are collapsed by case-insensitive comparison; the first
 *     occurrence's casing and position in the input order are preserved.
 *   - The deduplicated result must contain at most {@link SOFTWARE_USED_MAX}
 *     entries; otherwise the call rejects with `too_many_software_entries`.
 *
 * The function is pure and idempotent: feeding `value` back in always returns
 * the same `value` (Property 6).
 */
export function normalizeSoftwareList(
  input: ReadonlyArray<string>,
): SoftwareListNormalizationResult {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of input) {
    const trimmed = (typeof raw === 'string' ? raw : '').trim();
    if (
      trimmed.length < SOFTWARE_ENTRY_MIN_LENGTH ||
      trimmed.length > SOFTWARE_ENTRY_MAX_LENGTH
    ) {
      return { ok: false, code: 'invalid_software_entry' };
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }

  if (out.length > SOFTWARE_USED_MAX) {
    return { ok: false, code: 'too_many_software_entries' };
  }

  return { ok: true, value: out };
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
 * Validate that a persisted `Project` is ready to be published or scheduled.
 *
 * Evaluates every rule in Requirement 8 against the candidate Project
 * **without short-circuiting**, collects every failing code, and returns
 * the distinct, `RULE_ORDER`-ordered union so the CMS can show every
 * blocker at once (Requirement 8.9). The validator is pure: callers MUST
 * treat `{ ok: false }` as a no-op for state — they do not write any
 * column to the persisted Project on the rejection branch (Requirement
 * 8.1).
 *
 * Codes (in `RULE_ORDER`):
 *   - `missing_title`           (`title` empty after trim — Requirement 8.2)
 *   - `invalid_slug`            (`slug` does not match the slug pattern — Requirement 8.3)
 *   - `missing_category`        (`categoryId` empty — Requirement 8.4)
 *   - `missing_cover`           (`coverMediaId` is null — Requirement 8.5)
 *   - `no_media`                (`mediaItems` is empty — Requirement 8.6)
 *   - `missing_alt_text`        (any image-kind Media_Item lacks non-empty
 *                                trimmed alt text — Requirement 8.7;
 *                                emitted at most once regardless of how
 *                                many image rows offend)
 *   - `block_reference_broken`  (any `SectionBlock` references a missing
 *                                Media_Item or one whose kind does not
 *                                match the block's kind — Requirement 8.8;
 *                                only checked when section blocks are
 *                                supplied via the optional second
 *                                argument or via `project.sectionBlocks`)
 *
 * The Project domain type does not yet expose `sectionBlocks` directly;
 * pass them in via the second argument to enable the
 * `block_reference_broken` rule. When omitted, the section-block check is
 * skipped and existing call sites remain compatible.
 *
 * Pure function: no clock or I/O dependency.
 */
export function validatePublishable(
  project: Project,
  sectionBlocks?: ReadonlyArray<SectionBlock>,
): PublishableValidationResult {
  const failing = new Set<PublishReadinessCode>();

  // Rule 1: title.
  if (!hasNonEmptyTitle(project.title)) {
    failing.add('missing_title');
  }

  // Rule 2: slug.
  if (!validateSlug(project.slug)) {
    failing.add('invalid_slug');
  }

  // Rule 3: category.
  if (typeof project.categoryId !== 'string' || project.categoryId.length === 0) {
    failing.add('missing_category');
  }

  // Rule 4: cover.
  if (project.coverMediaId == null) {
    failing.add('missing_cover');
  }

  // Rule 5: media.
  const mediaItems = project.mediaItems ?? [];
  if (mediaItems.length === 0) {
    failing.add('no_media');
  }

  // Rule 6: alt text on image-kind media. Collapsed to a single code per
  // RULE_ORDER so the output is a distinct union regardless of how many
  // image rows offend.
  for (const item of mediaItems) {
    if (item.kind === 'image' && !hasNonEmptyAltText(item)) {
      failing.add('missing_alt_text');
      break;
    }
  }

  // Rule 7: every Section_Block must reference an existing Media_Item on
  // this project whose kind matches the block's kind. Skip when the
  // caller did not supply section blocks (e.g. legacy call sites).
  const blocks = sectionBlocks ?? readSectionBlocks(project);
  if (blocks !== undefined && blocks.length > 0) {
    if (anyBlockReferenceBroken(blocks, mediaItems)) {
      failing.add('block_reference_broken');
    }
  }

  if (failing.size === 0) {
    return { ok: true };
  }

  // Filter against RULE_ORDER so the output collapses duplicate
  // detections and the order is stable across calls.
  const missing = RULE_ORDER.filter((code) => failing.has(code));
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

/**
 * Read a possibly-attached `sectionBlocks` field from a Project. The
 * domain type does not yet declare this field, but call sites that have
 * access to the section blocks (via the Prisma relation) may attach them
 * before passing the project to `validatePublishable`. The optional
 * second argument to `validatePublishable` is the supported way to
 * supply blocks; this fallback only exists to keep future call sites
 * working without a second-argument plumbing pass.
 */
function readSectionBlocks(
  project: Project,
): ReadonlyArray<SectionBlock> | undefined {
  const candidate = (project as Project & {
    readonly sectionBlocks?: ReadonlyArray<SectionBlock>;
  }).sectionBlocks;
  return Array.isArray(candidate) ? candidate : undefined;
}

/**
 * Return `true` iff any block in `blocks` references a Media_Item that is
 * absent from `mediaItems` or whose kind does not match the block's kind
 * (Requirement 8.8). `text` blocks are exempt — they carry no media
 * reference and are always considered well-formed for this rule.
 */
function anyBlockReferenceBroken(
  blocks: ReadonlyArray<SectionBlock>,
  mediaItems: ReadonlyArray<MediaItem>,
): boolean {
  const byId = new Map<string, MediaItem>();
  for (const m of mediaItems) {
    byId.set(m.id as unknown as string, m);
  }

  for (const block of blocks) {
    switch (block.kind) {
      case 'text':
        // text blocks have no media reference; always well-formed here.
        continue;
      case 'image':
      case 'video':
      case 'model3d': {
        if (block.mediaItemId == null) {
          return true;
        }
        const ref = byId.get(block.mediaItemId as unknown as string);
        if (ref === undefined) {
          return true;
        }
        if (
          (block.kind === 'image' && ref.kind !== 'image') ||
          (block.kind === 'video' && ref.kind !== 'video') ||
          (block.kind === 'model3d' && ref.kind !== 'model3d')
        ) {
          return true;
        }
        break;
      }
      case 'image_pair': {
        if (block.mediaItemId == null || block.mediaItemBId == null) {
          return true;
        }
        const a = byId.get(block.mediaItemId as unknown as string);
        const b = byId.get(block.mediaItemBId as unknown as string);
        if (a === undefined || b === undefined) {
          return true;
        }
        if (a.kind !== 'image' || b.kind !== 'image') {
          return true;
        }
        break;
      }
    }
  }

  return false;
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
