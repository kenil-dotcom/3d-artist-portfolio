/**
 * Pure validators and reducers for Section_Block CRUD.
 *
 * The Section_Editor in `app/admin/(protected)/projects/[id]/edit/` lets the
 * Admin assemble a Project's body from typed, ordered blocks: `text`,
 * `image`, `image_pair`, `video`, and `model3d`. This module is the single
 * application-layer trust boundary for those payloads. Server actions in
 * `app/admin/(protected)/projects/[id]/edit/section-actions.ts` (task 6.1)
 * call into these helpers before any database write so the kind / media /
 * body invariants in Requirement 1 are enforced uniformly across add and
 * update paths.
 *
 * The module is pure: no Prisma, no `revalidatePath`, no clock fallback.
 * Every dependency (`project` snapshot, `mediaIndex` lookup, current block
 * count) is supplied by the caller so the validators are deterministic and
 * cheap to property-test.
 *
 * Spec references:
 *   - Requirement 1.3   — added blocks land at `ordering = N`.
 *   - Requirement 1.4   — `text` body trimmed and sanitised before persist.
 *   - Requirement 1.5–1.8 — every media-bearing block kind requires a
 *                           reference of the matching kind on the same
 *                           Project.
 *   - Requirement 1.9   — reorder yields a contiguous `0..N-1` sequence.
 *   - Requirement 1.10  — remove + renumber yields a contiguous sequence.
 *   - Requirement 1.11  — broken / cross-project reference rejects with
 *                         `block_media_mismatch`.
 *   - Requirement 1.12  — kind / media-kind disagreement rejects with
 *                         `block_kind_mismatch`.
 *   - Requirement 1.14  — empty or >10000-char text body rejects with
 *                         `invalid_text_body`.
 *   - Requirement 1.15  — duplicate `image_pair` references reject with
 *                         `block_image_pair_duplicate_media`.
 *   - Requirement 1.18  — missing required reference rejects with
 *                         `block_media_required` BEFORE any lookup runs.
 *   - Requirement 1.19  — 200-block cap rejects new adds with
 *                         `block_limit_exceeded`.
 *
 * Design references:
 *   - "Section_Block payload validation rules" subsection of design.md
 *     (the kind table this module encodes).
 *   - Properties 3 and 4 ("Section_Block ordering reducers" and
 *     "Section_Block kind/media matching is total").
 */

import 'server-only';

import sanitizeHtml from 'sanitize-html';

import type {
  MediaItem,
  MediaItemId,
  Project,
  SectionBlock,
  SectionBlockKind,
} from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of Section_Blocks a single Project may carry. The cap is
 * enforced inside the same transaction as the insert in
 * `addSectionBlock` (task 6.1) so it holds under concurrent adds
 * (Requirement 1.19).
 */
export const MAX_SECTION_BLOCKS_PER_PROJECT = 200;

/**
 * Inclusive upper bound on the trimmed length of a `text` block's
 * sanitised body (Requirement 1.14).
 */
export const TEXT_BODY_MAX_LENGTH = 10_000;

/**
 * Allow-list passed to `sanitize-html` for `text` block bodies. The list
 * matches the editor's documented rich-text feature set (paragraphs, line
 * breaks, lists, inline emphasis, links). HTTPS is the only permitted URL
 * scheme so a malicious paste cannot smuggle a `javascript:` href through
 * the editor.
 */
const TEXT_BODY_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['https'],
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Stable machine-readable rejection codes raised by the validators in
 * this module. The strings are also surfaced verbatim by the
 * `addSectionBlock` / `updateSectionBlock` server actions so the client
 * editor can branch on `code` without parsing free-text messages.
 */
export type SectionBlockErrorCode =
  | 'block_media_required'
  | 'block_media_mismatch'
  | 'block_kind_mismatch'
  | 'block_image_pair_duplicate_media'
  | 'invalid_text_body'
  | 'block_limit_exceeded';

/**
 * Discriminated rejection envelope. `code` is the stable key for
 * client-side branching; `message` is the human-readable reason surfaced
 * to the Admin alongside the failing field or row.
 */
export interface SectionBlockError {
  readonly code: SectionBlockErrorCode;
  readonly message: string;
}

/**
 * Two-armed result envelope used by every validator in this module. The
 * shape mirrors the `Result<T>` envelope documented in design.md (action
 * result envelopes section) but parameterises the error arm so callers
 * can narrow on `code` rather than parsing strings.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

/**
 * Caller-supplied input to the add/update validators. The shape carries
 * every field of `SectionBlock` because the validators normalise the
 * `body` / `mediaItemId` / `mediaItemBId` fields per the kind table and
 * return a fully-typed `SectionBlock`. The caller threads through `id`,
 * `projectId`, `ordering`, and the timestamps; the validator never
 * fabricates them.
 */
export type SectionBlockInput = SectionBlock;

/**
 * Lookup table the caller builds from `prisma.mediaItem.findMany({ where:
 * { projectId } })`. Keyed by Media_Item id so the validators can confirm
 * `(projectId, kind)` for each referenced media row in O(1) without
 * issuing per-block queries. Marking the map readonly signals the
 * validators do not mutate it.
 */
export type MediaIndex = ReadonlyMap<MediaItemId, MediaItem>;

/**
 * Minimum slice of a `Project` the validators read. Pinning this to a
 * `Pick` lets unit and property tests fabricate fixtures without
 * filling in every Project field.
 */
export type ProjectSnapshot = Pick<Project, 'id'>;

// ---------------------------------------------------------------------------
// validateAddBlock / validateUpdateBlock
// ---------------------------------------------------------------------------

/**
 * Validate a Section_Block payload against the kind table in design.md.
 *
 * Both add and update follow the same rules — the only call-site
 * difference is that `addSectionBlock` additionally invokes
 * `enforceBlockLimit` against the current row count before this
 * validator runs.
 *
 * Acceptance order is deterministic so failures are reported in a
 * predictable, testable sequence:
 *   1. For media-bearing kinds, the required reference (or both, for
 *      `image_pair`) must be present and non-empty — otherwise
 *      `block_media_required` (Requirement 1.18). This check runs before
 *      any `mediaIndex` lookup.
 *   2. The supplied id(s) must resolve in `mediaIndex` and the resolved
 *      row(s) must belong to `project.id` — otherwise
 *      `block_media_mismatch` (Requirement 1.11).
 *   3. The resolved row(s)'s `kind` must match the block kind —
 *      otherwise `block_kind_mismatch` (Requirement 1.12).
 *   4. For `image_pair`, the two ids must be distinct — otherwise
 *      `block_image_pair_duplicate_media` (Requirement 1.15).
 *   5. For `text`, the body is sanitised, trimmed, and bounded against
 *      `TEXT_BODY_MAX_LENGTH` — otherwise `invalid_text_body`
 *      (Requirement 1.4 / 1.14).
 *
 * On success the validator returns a normalised `SectionBlock` whose
 * `body`, `mediaItemId`, and `mediaItemBId` fields satisfy the kind
 * table (e.g., a `text` block always returns `mediaItemId = null` even
 * if the input erroneously carried an id). The caller persists this
 * normalised value rather than the raw input.
 */
export function validateAddBlock(
  input: SectionBlockInput,
  project: ProjectSnapshot,
  mediaIndex: MediaIndex,
): Result<SectionBlock, SectionBlockError> {
  return validateBlockShape(input, project, mediaIndex);
}

/**
 * Update-path counterpart to `validateAddBlock`. The rules in the kind
 * table apply identically to updates; the only difference is that
 * `validateUpdateBlock` is not paired with `enforceBlockLimit` because
 * an update never grows the count.
 */
export function validateUpdateBlock(
  input: SectionBlockInput,
  project: ProjectSnapshot,
  mediaIndex: MediaIndex,
): Result<SectionBlock, SectionBlockError> {
  return validateBlockShape(input, project, mediaIndex);
}

// ---------------------------------------------------------------------------
// enforceBlockLimit
// ---------------------------------------------------------------------------

/**
 * Reject when a Project is already at the `MAX_SECTION_BLOCKS_PER_PROJECT`
 * cap (Requirement 1.19). The caller — `addSectionBlock` — invokes this
 * inside the same Prisma transaction that inserts the new row so the cap
 * holds under concurrent adds: two parallel adds racing for the 200th
 * slot will see different `currentCount` snapshots and at most one
 * insert commits.
 *
 * The `projectId` is part of the signature so the rejection message can
 * identify the affected Project for log surfaces; it is not used in the
 * inequality itself.
 */
export function enforceBlockLimit(
  projectId: Project['id'],
  currentCount: number,
): Result<undefined, SectionBlockError> {
  if (!Number.isFinite(currentCount) || currentCount < 0) {
    // Defensive guard: a non-finite or negative count cannot anchor a
    // meaningful comparison. Treat as cap-exceeded rather than allowing
    // an unbounded write.
    return {
      ok: false,
      error: {
        code: 'block_limit_exceeded',
        message: `Project ${projectId} reported an invalid section-block count.`,
      },
    };
  }

  if (currentCount >= MAX_SECTION_BLOCKS_PER_PROJECT) {
    return {
      ok: false,
      error: {
        code: 'block_limit_exceeded',
        message: `Project ${projectId} already has the maximum of ${MAX_SECTION_BLOCKS_PER_PROJECT} section blocks.`,
      },
    };
  }

  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------------------
// validateImagePairDistinct
// ---------------------------------------------------------------------------

/**
 * Standalone duplicate-id check for the `image_pair` kind. Exported so
 * unit tests and the property test (task 2.5) can exercise the rule in
 * isolation; `validateAddBlock` / `validateUpdateBlock` invoke it
 * internally as part of the kind-specific path.
 *
 * Returns `block_image_pair_duplicate_media` only when both references
 * are non-null and equal. Null references are not the duplicate-id
 * concern of this helper — they are caught earlier by the
 * `block_media_required` guard.
 */
export function validateImagePairDistinct(input: {
  readonly mediaItemId: MediaItemId | null;
  readonly mediaItemBId: MediaItemId | null;
}): Result<undefined, SectionBlockError> {
  const { mediaItemId, mediaItemBId } = input;

  if (
    mediaItemId !== null &&
    mediaItemBId !== null &&
    mediaItemId === mediaItemBId
  ) {
    return {
      ok: false,
      error: {
        code: 'block_image_pair_duplicate_media',
        message:
          'image_pair blocks must reference two distinct media items.',
      },
    };
  }

  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------------------
// renumberBlocks
// ---------------------------------------------------------------------------

/**
 * Renumber a list of Section_Blocks to a contiguous `0..N-1` sequence
 * preserving the input's index order. Used after a remove or a reorder
 * to keep `ordering` dense (Requirement 1.10, Requirement 1.9).
 *
 * The function is a pure structural map: it does not mutate the input
 * array or any of the block objects. Each block's identity (id, kind,
 * body, media references, timestamps) is preserved verbatim — only
 * `ordering` is rewritten.
 */
export function renumberBlocks(
  blocks: ReadonlyArray<SectionBlock>,
): ReadonlyArray<SectionBlock> {
  return blocks.map((block, index) => ({ ...block, ordering: index }));
}

// ---------------------------------------------------------------------------
// appendBlock
// ---------------------------------------------------------------------------

/**
 * Place a new Section_Block at the end of `blocks` with
 * `ordering = blocks.length` (Requirement 1.3). Exposed as a separate
 * helper so the editor's optimistic state machine and the server-side
 * reducer share one source of truth for "what does append mean?".
 *
 * The function does not validate `newBlock` — call `validateAddBlock`
 * first.
 */
export function appendBlock(
  blocks: ReadonlyArray<SectionBlock>,
  newBlock: SectionBlock,
): ReadonlyArray<SectionBlock> {
  return [...blocks, { ...newBlock, ordering: blocks.length }];
}

// ---------------------------------------------------------------------------
// Internal: per-kind validation
// ---------------------------------------------------------------------------

function validateBlockShape(
  input: SectionBlockInput,
  project: ProjectSnapshot,
  mediaIndex: MediaIndex,
): Result<SectionBlock, SectionBlockError> {
  switch (input.kind) {
    case 'text':
      return validateTextBlock(input);
    case 'image':
      return validateSingleMediaBlock(input, project, mediaIndex, 'image');
    case 'image_pair':
      return validateImagePairBlock(input, project, mediaIndex);
    case 'video':
      return validateSingleMediaBlock(input, project, mediaIndex, 'video');
    case 'model3d':
      return validateSingleMediaBlock(input, project, mediaIndex, 'model3d');
  }
}

function validateTextBlock(
  input: SectionBlockInput,
): Result<SectionBlock, SectionBlockError> {
  const rawBody = typeof input.body === 'string' ? input.body : '';

  // Server-side sanitisation is the only trust boundary even when the
  // client editor is also sanitising (design.md "Text body
  // sanitisation"). The allow-list is locked to the documented
  // rich-text feature set; everything outside it is stripped before the
  // length / emptiness checks run.
  const sanitised = sanitizeHtml(rawBody, TEXT_BODY_SANITIZE_OPTIONS);
  const trimmed = sanitised.trim();

  if (trimmed.length === 0) {
    return invalidTextBody('Text block body cannot be empty after sanitisation.');
  }
  if (trimmed.length > TEXT_BODY_MAX_LENGTH) {
    return invalidTextBody(
      `Text block body exceeds the ${TEXT_BODY_MAX_LENGTH}-character limit.`,
    );
  }

  return {
    ok: true,
    value: {
      ...input,
      kind: 'text',
      body: trimmed,
      // text blocks never carry media references; normalise away any
      // ids the client erroneously supplied.
      mediaItemId: null,
      mediaItemBId: null,
    },
  };
}

function validateSingleMediaBlock(
  input: SectionBlockInput,
  project: ProjectSnapshot,
  mediaIndex: MediaIndex,
  expectedKind: Extract<SectionBlockKind, 'image' | 'video' | 'model3d'>,
): Result<SectionBlock, SectionBlockError> {
  if (!isNonEmptyMediaId(input.mediaItemId)) {
    return mediaRequired(
      `${expectedKind} blocks require a media item reference.`,
    );
  }

  const lookup = resolveMediaReference(
    input.mediaItemId,
    project,
    mediaIndex,
    expectedKind,
  );
  if (!lookup.ok) {
    return lookup;
  }

  return {
    ok: true,
    value: {
      ...input,
      kind: expectedKind,
      // media-bearing kinds never carry a `body`; normalise away any
      // text the client erroneously supplied.
      body: null,
      mediaItemId: input.mediaItemId,
      mediaItemBId: null,
    },
  };
}

function validateImagePairBlock(
  input: SectionBlockInput,
  project: ProjectSnapshot,
  mediaIndex: MediaIndex,
): Result<SectionBlock, SectionBlockError> {
  // Required-reference check runs first so a missing id never falls
  // through to a `block_media_mismatch` (Requirement 1.18).
  if (
    !isNonEmptyMediaId(input.mediaItemId) ||
    !isNonEmptyMediaId(input.mediaItemBId)
  ) {
    return mediaRequired(
      'image_pair blocks require two media item references.',
    );
  }

  const primary = resolveMediaReference(
    input.mediaItemId,
    project,
    mediaIndex,
    'image',
  );
  if (!primary.ok) {
    return primary;
  }

  const secondary = resolveMediaReference(
    input.mediaItemBId,
    project,
    mediaIndex,
    'image',
  );
  if (!secondary.ok) {
    return secondary;
  }

  const distinct = validateImagePairDistinct({
    mediaItemId: input.mediaItemId,
    mediaItemBId: input.mediaItemBId,
  });
  if (!distinct.ok) {
    return distinct;
  }

  return {
    ok: true,
    value: {
      ...input,
      kind: 'image_pair',
      body: null,
      mediaItemId: input.mediaItemId,
      mediaItemBId: input.mediaItemBId,
    },
  };
}

/**
 * Resolve a Media_Item id against the caller-supplied lookup table and
 * confirm it belongs to the target Project (`block_media_mismatch`) and
 * carries the expected kind (`block_kind_mismatch`).
 *
 * The function never throws. A missing id is the caller's responsibility
 * to catch up-stream (`block_media_required`); calling `resolveMediaReference`
 * with a missing id is a programmer error and is treated as
 * `block_media_mismatch` defensively.
 */
function resolveMediaReference(
  mediaId: MediaItemId,
  project: ProjectSnapshot,
  mediaIndex: MediaIndex,
  expectedKind: SectionBlockKind & ('image' | 'video' | 'model3d'),
): Result<MediaItem, SectionBlockError> {
  const row = mediaIndex.get(mediaId);
  if (row === undefined || row.projectId !== project.id) {
    return {
      ok: false,
      error: {
        code: 'block_media_mismatch',
        message: `Media item ${mediaId} does not belong to project ${project.id}.`,
      },
    };
  }

  if (row.kind !== expectedKind) {
    return {
      ok: false,
      error: {
        code: 'block_kind_mismatch',
        message: `Media item ${mediaId} has kind ${row.kind} but the block expects ${expectedKind}.`,
      },
    };
  }

  return { ok: true, value: row };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function isNonEmptyMediaId(
  value: MediaItemId | null | undefined,
): value is MediaItemId {
  return typeof value === 'string' && value.length > 0;
}

function mediaRequired(
  message: string,
): Result<SectionBlock, SectionBlockError> {
  return {
    ok: false,
    error: { code: 'block_media_required', message },
  };
}

function invalidTextBody(
  message: string,
): Result<SectionBlock, SectionBlockError> {
  return {
    ok: false,
    error: { code: 'invalid_text_body', message },
  };
}
