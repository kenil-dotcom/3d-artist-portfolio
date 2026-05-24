'use server';

/**
 * Server actions for Section_Block CRUD on a single Project.
 *
 * Each action is the trust boundary between the editor client and the
 * database: it asserts the admin session via `requireAdmin()`, runs the
 * pure validators in `lib/admin/sectionBlocks.ts` (which include the
 * server-side `sanitize-html` pass for `text` bodies and the 200-block
 * cap check), and persists multi-row writes inside a single Prisma
 * transaction so partial failures cannot leave the ordering field in a
 * non-contiguous state.
 *
 * Task 6.2 will fold the simple `revalidatePath` calls below into a
 * warnings-aware variant that surfaces revalidation failures to the
 * editor banner; for now a failed revalidation throws and the action
 * surfaces the error, which is acceptable for the MVP.
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
 *   - Requirement 1.16  — foreign block id in reorder rejects with
 *                         `unknown_block_id` before any mutation.
 *   - Requirement 1.17  — count mismatch in reorder rejects with
 *                         `reorder_count_mismatch` before any mutation.
 *   - Requirement 1.18  — missing required reference rejects with
 *                         `block_media_required` BEFORE any lookup runs.
 *   - Requirement 1.19  — 200-block cap rejects new adds with
 *                         `block_limit_exceeded`.
 *   - Requirement 12.1  — every action invokes `requireAdmin()` first.
 */

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import {
  appendBlock,
  enforceBlockLimit,
  renumberBlocks,
  validateAddBlock,
  validateUpdateBlock,
  type MediaIndex,
  type SectionBlockErrorCode,
} from '@/lib/admin/sectionBlocks';
import type {
  ContentHash,
  MediaItem,
  MediaItemId,
  MediaKind,
  MediaMimeType,
  ProjectId,
  SectionBlock,
  SectionBlockId,
  SectionBlockKind,
  VariantSet,
  IsoTimestamp,
} from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Result envelopes
// ---------------------------------------------------------------------------

/**
 * Discriminated `Result<T>` envelope returned by every action in this
 * module, matching the shape documented in design.md "Action result
 * envelopes". The error arm always carries a stable machine-readable
 * `code` plus a human-readable `error` string the editor renders against
 * the offending field or row.
 */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly error: string };

/**
 * Stable rejection codes raised by the section-block server actions.
 * Includes the validator codes from `lib/admin/sectionBlocks.ts` plus
 * the action-level codes (`unknown_block_id`, `reorder_count_mismatch`,
 * `reorder_duplicate_id`, `block_not_found`, `project_not_found`).
 */
export type SectionActionErrorCode =
  | SectionBlockErrorCode
  | 'unknown_block_id'
  | 'reorder_count_mismatch'
  | 'reorder_duplicate_id'
  | 'block_not_found'
  | 'project_not_found';

/**
 * Plain client-side payload for `addSectionBlock`. The `kind` argument
 * is supplied separately so a client component can render a per-kind
 * input without juggling discriminated unions over the wire.
 */
export interface AddSectionBlockPayload {
  readonly body?: string | null;
  readonly mediaItemId?: string | null;
  readonly mediaItemBId?: string | null;
}

/**
 * Plain client-side patch for `updateSectionBlock`. Only the editable
 * fields (`body`, `mediaItemId`, `mediaItemBId`) may be patched; `kind`,
 * `projectId`, and `ordering` are immutable through this entry point.
 * `undefined` keeps the existing column value; explicit `null` clears
 * it (subject to validator rules, e.g., a `text` block's `body` cannot
 * be cleared without rejecting `invalid_text_body`).
 */
export interface SectionBlockPatch {
  readonly body?: string | null;
  readonly mediaItemId?: string | null;
  readonly mediaItemBId?: string | null;
}

/**
 * Persisted shape returned to the client. Mirrors the domain
 * `SectionBlock` type with timestamps serialised as ISO strings so the
 * value crosses the server/client boundary without `Date` reanimation.
 */
export interface PersistedSectionBlock {
  readonly id: string;
  readonly projectId: string;
  readonly kind: SectionBlockKind;
  readonly ordering: number;
  readonly body: string | null;
  readonly mediaItemId: string | null;
  readonly mediaItemBId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function brand<B>(value: string): B {
  return value as unknown as B;
}

/**
 * Revalidate the admin and public surfaces affected by a section-block
 * mutation. Task 6.2 will replace these with the warnings-aware variant
 * that accumulates per-path failures into `revalidationWarnings` on the
 * action result. For now we use the same simple sequence the existing
 * project actions use (admin list, home, gallery, project detail).
 */
function revalidateForProject(slug: string | null): void {
  revalidatePath('/admin/projects');
  revalidatePath('/');
  revalidatePath('/gallery');
  if (slug !== null && slug.length > 0) {
    revalidatePath(`/projects/${slug}`);
  }
}

/**
 * Convert a Prisma `MediaItem` row to the domain `MediaItem` shape the
 * validators consume. The validators only inspect `kind` and
 * `projectId`, but the type contract requires the full structure so we
 * fill every field.
 */
function rowToMediaItem(row: {
  id: string;
  projectId: string;
  storageKey: string;
  contentHash: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  byteSize: number;
  kind: string;
  altText: string | null;
  caption: string | null;
  ordering: number;
  transcript: string | null;
  embedUrl: string | null;
  extension: string | null;
  variantSet: unknown;
}): MediaItem {
  return {
    id: brand<MediaItemId>(row.id),
    projectId: brand<ProjectId>(row.projectId),
    ref: {
      storageKey: row.storageKey,
      contentHash: brand<ContentHash>(row.contentHash),
      mimeType: row.mimeType as MediaMimeType,
      width: row.width,
      height: row.height,
      durationSec: row.durationSec,
      byteSize: row.byteSize,
    },
    kind: row.kind as MediaKind,
    altText: row.altText,
    caption: row.caption,
    ordering: row.ordering,
    captionsRef: null,
    transcript: row.transcript,
    embedUrl: row.embedUrl,
    extension: row.extension,
    variantSet:
      (row.variantSet as VariantSet | null) ?? {
        renditions: [],
        failures: [],
      },
  };
}

/**
 * Build a `MediaIndex` for the supplied project. The index lets the
 * validators resolve `(projectId, kind)` for each referenced media row
 * in O(1) without per-block queries.
 *
 * Skipped for `text` blocks because they carry no media references —
 * loading the project's media for a `text` block would be wasted work.
 */
async function loadMediaIndex(projectId: string): Promise<MediaIndex> {
  const rows = await prisma.mediaItem.findMany({
    where: { projectId },
  });
  const map = new Map<MediaItemId, MediaItem>();
  for (const row of rows) {
    map.set(brand<MediaItemId>(row.id), rowToMediaItem(row));
  }
  return map;
}

/**
 * Convert a Prisma `SectionBlock` row to the wire shape returned to the
 * client.
 */
function rowToPersisted(row: {
  id: string;
  projectId: string;
  kind: string;
  ordering: number;
  body: string | null;
  mediaItemId: string | null;
  mediaItemBId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): PersistedSectionBlock {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as SectionBlockKind,
    ordering: row.ordering,
    body: row.body,
    mediaItemId: row.mediaItemId,
    mediaItemBId: row.mediaItemBId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const PLACEHOLDER_TIMESTAMP: IsoTimestamp = brand<IsoTimestamp>(
  '1970-01-01T00:00:00.000Z',
);

/**
 * Synthesize the `SectionBlockInput` shape the validators expect from
 * the action's primitive arguments. The validator only inspects `kind`,
 * `body`, `mediaItemId`, `mediaItemBId`, and `projectId`; the remaining
 * fields are spread through to the validator's normalised result but
 * never used downstream — we extract `body`/`mediaItemId`/`mediaItemBId`
 * from the result and let Prisma stamp the database columns the action
 * controls (`id`, `ordering`, `createdAt`, `updatedAt`).
 */
function buildBlockInput(args: {
  readonly id: string | null;
  readonly projectId: string;
  readonly kind: SectionBlockKind;
  readonly ordering: number;
  readonly body: string | null;
  readonly mediaItemId: string | null;
  readonly mediaItemBId: string | null;
}): SectionBlock {
  return {
    id: brand<SectionBlockId>(args.id ?? '00000000-0000-0000-0000-000000000000'),
    projectId: brand<ProjectId>(args.projectId),
    kind: args.kind,
    ordering: args.ordering,
    body: args.body,
    mediaItemId:
      args.mediaItemId === null || args.mediaItemId.length === 0
        ? null
        : brand<MediaItemId>(args.mediaItemId),
    mediaItemBId:
      args.mediaItemBId === null || args.mediaItemBId.length === 0
        ? null
        : brand<MediaItemId>(args.mediaItemBId),
    createdAt: PLACEHOLDER_TIMESTAMP,
    updatedAt: PLACEHOLDER_TIMESTAMP,
  };
}

// ---------------------------------------------------------------------------
// addSectionBlock
// ---------------------------------------------------------------------------

/**
 * Append a new Section_Block to a Project. The new block lands at
 * `ordering = N` where `N` is the current count of Section_Blocks for
 * the Project (Requirement 1.3).
 *
 * The block-count cap is enforced inside the same Prisma transaction as
 * the insert: `prisma.sectionBlock.count({ where: { projectId } })` is
 * sampled and compared against `MAX_SECTION_BLOCKS_PER_PROJECT` before
 * the insert runs. Two parallel adds racing for the 200th slot will see
 * different snapshots and at most one insert commits (Requirement 1.19).
 */
export async function addSectionBlock(
  projectId: string,
  kind: SectionBlockKind,
  payload: AddSectionBlockPayload,
): Promise<Result<PersistedSectionBlock>> {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true },
  });
  if (project === null) {
    return {
      ok: false,
      code: 'project_not_found',
      error: 'Project not found.',
    };
  }

  // `text` blocks carry no media references, so skip the index load.
  // Every other kind requires the index for `block_media_mismatch` /
  // `block_kind_mismatch` resolution (Requirement 1.11 / 1.12).
  const mediaIndex: MediaIndex =
    kind === 'text' ? new Map() : await loadMediaIndex(projectId);

  try {
    const created = await prisma.$transaction(async (tx) => {
      // Sample the current block count inside the same transaction as
      // the insert so the 200-block cap holds under concurrent adds
      // (Requirement 1.19).
      const currentCount = await tx.sectionBlock.count({
        where: { projectId },
      });

      const limit = enforceBlockLimit(brand<ProjectId>(projectId), currentCount);
      if (!limit.ok) {
        throw new ValidationFailure(limit.error.code, limit.error.message);
      }

      const input = buildBlockInput({
        id: null,
        projectId,
        kind,
        ordering: currentCount,
        body: payload.body ?? null,
        mediaItemId: payload.mediaItemId ?? null,
        mediaItemBId: payload.mediaItemBId ?? null,
      });

      const validation = validateAddBlock(
        input,
        { id: brand<ProjectId>(projectId) },
        mediaIndex,
      );
      if (!validation.ok) {
        throw new ValidationFailure(
          validation.error.code,
          validation.error.message,
        );
      }
      const normalised = validation.value;

      // `appendBlock` is exposed by the validator module to keep the
      // "what does append mean?" reducer in one place. The reducer
      // confirms the new ordering is `currentCount`; we then persist
      // exactly that value.
      const placement = appendBlock([], normalised);
      const newBlock = placement[placement.length - 1];
      if (newBlock === undefined) {
        throw new Error('appendBlock produced no block');
      }

      return tx.sectionBlock.create({
        data: {
          projectId,
          kind: newBlock.kind,
          ordering: newBlock.ordering,
          body: newBlock.body,
          mediaItemId: newBlock.mediaItemId,
          mediaItemBId: newBlock.mediaItemBId,
        },
      });
    });

    revalidateForProject(project.slug);

    return { ok: true, value: rowToPersisted(created) };
  } catch (err) {
    if (err instanceof ValidationFailure) {
      return { ok: false, code: err.code, error: err.message };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// updateSectionBlock
// ---------------------------------------------------------------------------

/**
 * Patch an existing Section_Block's body or media references. The
 * block's `kind`, `projectId`, and `ordering` are immutable through
 * this entry point — kind changes go through delete + add, and
 * ordering changes go through `reorderSectionBlocks`.
 */
export async function updateSectionBlock(
  blockId: string,
  patch: SectionBlockPatch,
): Promise<Result<PersistedSectionBlock>> {
  await requireAdmin();

  const existing = await prisma.sectionBlock.findUnique({
    where: { id: blockId },
    include: {
      project: { select: { id: true, slug: true } },
    },
  });
  if (existing === null) {
    return {
      ok: false,
      code: 'block_not_found',
      error: 'Section block not found.',
    };
  }

  const projectId = existing.projectId;
  const kind = existing.kind as SectionBlockKind;

  // Apply the patch on top of the existing row's columns. `undefined`
  // keeps the existing column value; explicit `null` clears it (subject
  // to the validator rules in `validateUpdateBlock`).
  const nextBody = patch.body !== undefined ? patch.body : existing.body;
  const nextMediaItemId =
    patch.mediaItemId !== undefined ? patch.mediaItemId : existing.mediaItemId;
  const nextMediaItemBId =
    patch.mediaItemBId !== undefined
      ? patch.mediaItemBId
      : existing.mediaItemBId;

  const mediaIndex: MediaIndex =
    kind === 'text' ? new Map() : await loadMediaIndex(projectId);

  const input = buildBlockInput({
    id: blockId,
    projectId,
    kind,
    ordering: existing.ordering,
    body: nextBody,
    mediaItemId: nextMediaItemId,
    mediaItemBId: nextMediaItemBId,
  });

  const validation = validateUpdateBlock(
    input,
    { id: brand<ProjectId>(projectId) },
    mediaIndex,
  );
  if (!validation.ok) {
    return {
      ok: false,
      code: validation.error.code,
      error: validation.error.message,
    };
  }
  const normalised = validation.value;

  const updated = await prisma.sectionBlock.update({
    where: { id: blockId },
    data: {
      body: normalised.body,
      mediaItemId: normalised.mediaItemId,
      mediaItemBId: normalised.mediaItemBId,
    },
  });

  revalidateForProject(existing.project.slug);

  return { ok: true, value: rowToPersisted(updated) };
}

// ---------------------------------------------------------------------------
// removeSectionBlock
// ---------------------------------------------------------------------------

/**
 * Delete a Section_Block and renumber the survivors so their
 * `ordering` values remain a contiguous `0..N-1` sequence
 * (Requirement 1.10).
 *
 * The delete and the renumber run inside a single transaction so a
 * crash mid-renumber cannot leave the persisted ordering with gaps.
 */
export async function removeSectionBlock(
  blockId: string,
): Promise<Result<{ readonly removedId: string }>> {
  await requireAdmin();

  const existing = await prisma.sectionBlock.findUnique({
    where: { id: blockId },
    include: {
      project: { select: { slug: true } },
    },
  });
  if (existing === null) {
    return {
      ok: false,
      code: 'block_not_found',
      error: 'Section block not found.',
    };
  }

  const projectId = existing.projectId;

  await prisma.$transaction(async (tx) => {
    await tx.sectionBlock.delete({ where: { id: blockId } });

    const remaining = await tx.sectionBlock.findMany({
      where: { projectId },
      orderBy: [{ ordering: 'asc' }, { createdAt: 'asc' }],
    });

    // `renumberBlocks` is the pure reducer the validator module
    // exposes; we project the surviving rows into the SectionBlock
    // shape, hand them to the reducer, and persist whatever ordering
    // values it returns. This keeps "what does renumber mean?" in one
    // testable place.
    const projected: ReadonlyArray<SectionBlock> = remaining.map((row) => ({
      id: brand<SectionBlockId>(row.id),
      projectId: brand<ProjectId>(row.projectId),
      kind: row.kind as SectionBlockKind,
      ordering: row.ordering,
      body: row.body,
      mediaItemId:
        row.mediaItemId === null ? null : brand<MediaItemId>(row.mediaItemId),
      mediaItemBId:
        row.mediaItemBId === null
          ? null
          : brand<MediaItemId>(row.mediaItemBId),
      createdAt: brand<IsoTimestamp>(row.createdAt.toISOString()),
      updatedAt: brand<IsoTimestamp>(row.updatedAt.toISOString()),
    }));
    const renumbered = renumberBlocks(projected);

    for (const block of renumbered) {
      const previous = projected.find((b) => b.id === block.id);
      if (previous !== undefined && previous.ordering === block.ordering) {
        // Skip rows whose ordering didn't change so we don't issue a
        // no-op UPDATE for every survivor.
        continue;
      }
      await tx.sectionBlock.update({
        where: { id: block.id },
        data: { ordering: block.ordering },
      });
    }
  });

  revalidateForProject(existing.project.slug);

  return { ok: true, value: { removedId: blockId } };
}

// ---------------------------------------------------------------------------
// reorderSectionBlocks
// ---------------------------------------------------------------------------

/**
 * Atomically rewrite every Section_Block's `ordering` for a Project so
 * the persisted order matches the client's drag-and-drop result.
 * Mirrors the existing `reorderMediaList` envelope: validates id
 * ownership and count, plus the duplicate-id guard, before any row is
 * mutated; uses the same two-pass shift inside a single transaction so
 * the ordering field never has duplicate values mid-flight.
 */
export async function reorderSectionBlocks(
  projectId: string,
  orderedIds: ReadonlyArray<string>,
): Promise<Result<{ readonly reorderedCount: number }>> {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true },
  });
  if (project === null) {
    return {
      ok: false,
      code: 'project_not_found',
      error: 'Project not found.',
    };
  }

  // Duplicate-id check runs before any database write so a duplicate
  // list is rejected even when the count happens to match (e.g. one id
  // appears twice while another id is missing).
  const idSet = new Set(orderedIds);
  if (idSet.size !== orderedIds.length) {
    return {
      ok: false,
      code: 'reorder_duplicate_id',
      error: 'Reorder list contains duplicate block ids.',
    };
  }

  const existing = await prisma.sectionBlock.findMany({
    where: { projectId },
    select: { id: true },
  });

  if (existing.length !== orderedIds.length) {
    return {
      ok: false,
      code: 'reorder_count_mismatch',
      error: 'Reorder list does not match the project section-block set.',
    };
  }

  const existingIds = new Set(existing.map((b) => b.id));
  for (const id of orderedIds) {
    if (!existingIds.has(id)) {
      return {
        ok: false,
        code: 'unknown_block_id',
        error: `Unknown section-block id: ${id}.`,
      };
    }
  }

  // Two-pass renumber inside a single transaction, identical to
  // `reorderMediaList`. Pass 1 shifts every row to a non-overlapping
  // high bucket; pass 2 writes the final 0..N-1 ordering.
  await prisma.$transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (typeof id !== 'string') continue;
      await tx.sectionBlock.update({
        where: { id },
        data: { ordering: 1_000_000 + i },
      });
    }
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (typeof id !== 'string') continue;
      await tx.sectionBlock.update({
        where: { id },
        data: { ordering: i },
      });
    }
  });

  revalidateForProject(project.slug);

  return { ok: true, value: { reorderedCount: orderedIds.length } };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Internal sentinel thrown inside the `addSectionBlock` transaction so
 * a validator rejection rolls back the transaction and surfaces as the
 * `Result` error envelope at the action boundary. Throwing inside the
 * transaction callback is the documented Prisma pattern for aborting a
 * transaction without committing a partial write.
 */
class ValidationFailure extends Error {
  readonly code: SectionActionErrorCode;
  constructor(code: SectionActionErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ValidationFailure';
  }
}
