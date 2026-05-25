/**
 * Cover-media selection: shared validation + write logic.
 *
 * Both the user-facing `setCoverMedia` server action and the auto-set
 * path inside `finalizeUpload` route through `applyCoverSelection` so
 * the rejection codes and the "no-write-on-rejection" invariant are
 * defined in exactly one place (Requirements 5.1–5.4).
 *
 * The helper accepts a Prisma transaction client so callers can run
 * the cover write in the same transaction as a sibling row insert
 * (the `finalizeUpload` auto-set path requires this — design.md
 * "Cover selection lifecycle").
 */

import type { Prisma } from '@prisma/client';

export type CoverErrorCode =
  | 'cover_media_not_found'
  | 'cover_not_in_project'
  | 'cover_must_be_image';

export interface ApplyCoverSelectionOk {
  readonly ok: true;
  /**
   * Project slug captured pre-update so the caller can drive
   * `revalidatePath('/projects/{slug}')` without a second round trip.
   * Null when the project carries an empty slug (legacy rows only).
   */
  readonly slug: string | null;
}

export interface ApplyCoverSelectionErr {
  readonly ok: false;
  readonly code: CoverErrorCode;
}

export type ApplyCoverSelectionResult =
  | ApplyCoverSelectionOk
  | ApplyCoverSelectionErr;

/**
 * Validate and apply a cover-media selection inside the supplied
 * transaction. Returns a typed `Result` envelope.
 *
 * Rejection branches:
 *   - `cover_media_not_found` — the supplied `mediaId` does not resolve
 *     to an existing row (or the project itself is missing).
 *   - `cover_not_in_project` — the Media_Item exists but belongs to a
 *     different project.
 *   - `cover_must_be_image` — the Media_Item's `kind` is not `image`.
 *
 * Invariant: on every rejection branch, `Project.coverMediaId` is
 * byte-identical to its pre-call value. The structural guarantee is
 * that the `tx.project.update` call lives only on the success path —
 * `assertCoverUnchanged` (dev/test only) re-reads the row to catch
 * accidental future regressions before they reach production.
 *
 * The auto-set path inside `finalizeUpload` calls this helper directly
 * and ignores the rejection envelope, matching the "server-internal
 * variant of setCoverMedia that bypasses the user-facing rejection
 * codes" described in design.md.
 */
export async function applyCoverSelection(
  tx: Prisma.TransactionClient,
  projectId: string,
  mediaId: string,
): Promise<ApplyCoverSelectionResult> {
  const before = await tx.project.findUnique({
    where: { id: projectId },
    select: { coverMediaId: true, slug: true },
  });
  if (before === null) {
    return { ok: false, code: 'cover_media_not_found' };
  }
  const previousCoverId = before.coverMediaId ?? null;

  const item = await tx.mediaItem.findUnique({
    where: { id: mediaId },
    select: { projectId: true, kind: true },
  });

  if (item === null) {
    await assertCoverUnchanged(tx, projectId, previousCoverId);
    return { ok: false, code: 'cover_media_not_found' };
  }
  if (item.projectId !== projectId) {
    await assertCoverUnchanged(tx, projectId, previousCoverId);
    return { ok: false, code: 'cover_not_in_project' };
  }
  if (item.kind !== 'image') {
    await assertCoverUnchanged(tx, projectId, previousCoverId);
    return { ok: false, code: 'cover_must_be_image' };
  }

  await tx.project.update({
    where: { id: projectId },
    data: { coverMediaId: mediaId },
  });

  return { ok: true, slug: before.slug };
}

/**
 * Dev/test invariant: confirm `Project.coverMediaId` was not mutated
 * on the rejection branch. Skipped in production to avoid the extra
 * round trip on a hot path; the structural guarantee in
 * {@link applyCoverSelection} (no `update` call before the success
 * branch) is sufficient at runtime.
 */
async function assertCoverUnchanged(
  tx: Prisma.TransactionClient,
  projectId: string,
  expected: string | null,
): Promise<void> {
  if (process.env.NODE_ENV === 'production') return;
  const row = await tx.project.findUnique({
    where: { id: projectId },
    select: { coverMediaId: true },
  });
  const observed = row?.coverMediaId ?? null;
  if (observed !== expected) {
    throw new Error(
      `applyCoverSelection invariant violated: Project.coverMediaId changed from ${String(
        expected,
      )} to ${String(observed)} on a rejection branch.`,
    );
  }
}
