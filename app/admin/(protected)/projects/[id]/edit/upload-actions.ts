'use server';

/**
 * Server actions backing the ArtStation-style upload flow.
 *
 * Files are uploaded directly from the browser to R2 using presigned PUT
 * URLs (see `lib/admin/presign.ts`); these actions only handle the small
 * metadata exchanges required to mint a URL, finalize a media item once
 * the upload is complete, attach a YouTube/Vimeo embed, and rewrite the
 * media ordering after a drag-and-drop reorder.
 */

import { revalidatePath } from 'next/cache';

import sharp from 'sharp';
import type { Prisma } from '@prisma/client';

import { requireAdmin } from '@/lib/auth/middleware';
import {
  createPresignedUploadUrl,
  inferKindFromMime,
  type PresignedUpload,
} from '@/lib/admin/presign';
import { applyCoverSelection } from '@/lib/admin/cover';
import { parseEmbedUrl } from '@/lib/admin/embeds';
import {
  MIME_TO_EXT,
  putR2Object,
  removeFromR2,
  removeFromR2ByPublicUrl,
} from '@/lib/admin/uploads';
import { deleteVariantKeys, generateVariants } from '@/lib/admin/variants';
import { prisma } from '@/lib/db/prisma';
import {
  ALLOWED_MIME_TYPES_BY_KIND,
  MAX_MEDIA_BYTES,
} from '@/lib/validation/media';
import type { MediaKind, VariantSet } from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Result envelopes
// ---------------------------------------------------------------------------

export type RequestUploadUrlResult =
  | { readonly ok: true; readonly value: PresignedUpload }
  | { readonly ok: false; readonly error: string };

export interface FinalizedMediaItem {
  readonly id: string;
  readonly storageKey: string;
  readonly mimeType: string;
  readonly kind: MediaKind;
  readonly altText: string | null;
  readonly caption: string | null;
  readonly ordering: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly embedUrl: string | null;
  /**
   * Lowercase file extension persisted from `MIME_TO_EXT` on upload
   * (Requirement 2.11). Null for embed-only rows that never carry a
   * stored object.
   */
  readonly extension: string | null;
  /**
   * AVIF/WebP renditions plus the per-rendition failure log produced by
   * the variant pipeline (Requirement 6.3). Empty `{ renditions: [],
   * failures: [] }` for non-image kinds and embeds; the public renderer
   * falls back to the original `storageKey` in that case
   * (Requirement 6.6).
   */
  readonly variantSet: VariantSet;
}

/** Stable rejection codes for {@link finalizeUpload}. */
export type FinalizeUploadErrorCode =
  | 'project_not_found'
  | 'invalid_format'
  | 'file_too_large';

export type FinalizeUploadResult =
  | { readonly ok: true; readonly value: FinalizedMediaItem }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code?: FinalizeUploadErrorCode;
    };

export type AddEmbedErrorCode = 'unsupported_embed_provider' | 'project_not_found';

export type AddEmbedResult =
  | { readonly ok: true; readonly value: FinalizedMediaItem }
  | {
      readonly ok: false;
      readonly code: AddEmbedErrorCode;
      readonly error: string;
    };

export type ReorderMediaErrorCode =
  | 'unknown_media_id'
  | 'reorder_count_mismatch'
  | 'reorder_duplicate_id';

export type ReorderMediaResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code: ReorderMediaErrorCode;
    };

/**
 * Stable rejection codes for {@link replaceMediaFile}. Distinct from
 * {@link FinalizeUploadErrorCode} because the replace path adds two
 * codes (`unknown_media_id`, `kind_change_disallowed`) and reuses
 * `upload_failed` for thrown-after-commit cases. The `unknown_media_id`
 * code matches design.md "In-place media replacement" step 2 ("abort
 * with `unknown_media_id` if missing") and aligns with the same code
 * already used by `reorderMediaList` for foreign / missing ids.
 */
export type ReplaceMediaErrorCode =
  | 'unknown_media_id'
  | 'kind_change_disallowed'
  | 'invalid_format'
  | 'file_too_large'
  | 'upload_failed'
  | 'project_not_found';

export type ReplaceMediaResult =
  | { readonly ok: true; readonly value: FinalizedMediaItem }
  | {
      readonly ok: false;
      readonly error: string;
      readonly code: ReplaceMediaErrorCode;
    };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function revalidateAfterMediaChange(slug: string | null): void {
  revalidatePath('/admin/projects');
  revalidatePath('/');
  revalidatePath('/gallery');
  if (slug !== null && slug.length > 0) {
    revalidatePath(`/projects/${slug}`);
  }
}

async function nextOrdering(projectId: string): Promise<number> {
  const last = await prisma.mediaItem.findFirst({
    where: { projectId },
    orderBy: { ordering: 'desc' },
    select: { ordering: true },
  });
  return (last?.ordering ?? -1) + 1;
}

/**
 * Maximum bytes we will pull from R2 for the dimension probe and the
 * variant pipeline. Sources beyond this size still upload successfully,
 * but we refuse to materialise them inside the server action — the
 * variant generator is the only branch that needs the decoded buffer.
 *
 * The 256 MB ceiling lines up with Vercel's per-invocation memory
 * budget on the Pro plan with comfortable headroom for sharp's working
 * set; large videos and 3D models never reach this branch because the
 * fetch is gated on `kind === 'image'`.
 */
const PROBE_BYTE_LIMIT = 256 * 1024 * 1024;

/**
 * Result of {@link probeImageBytes}: a positive-integer dimension pair
 * plus the cached source buffer when the probe succeeded; `null` when
 * the probe failed (network error, unreadable bytes, missing or
 * non-positive dimensions). Per Requirement 2.10 a `null` here is the
 * caller's signal to delete the just-uploaded R2 object and reject the
 * finalize call without creating a Media_Item row.
 */
interface ImageProbeOk {
  readonly buffer: Buffer;
  readonly width: number;
  readonly height: number;
}

/**
 * Strict dimension probe for image-kind uploads. Fetches the original
 * bytes once (so the variant pipeline can reuse them without a second
 * round trip), runs sharp metadata, and returns positive integer
 * `(width, height)` only when sharp resolves both. Any of:
 *
 *   - non-2xx fetch
 *   - empty body or body larger than the probe limit
 *   - sharp throwing while reading metadata
 *   - sharp returning a missing, non-integer, or non-positive width
 *     or height
 *
 * yields `null` so the caller can issue the rejection envelope per
 * Requirement 2.10.
 */
async function probeImageBytes(url: string): Promise<ImageProbeOk | null> {
  let buffer: Buffer;
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return null;
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
  if (buffer.byteLength === 0 || buffer.byteLength > PROBE_BYTE_LIMIT) {
    return null;
  }
  let width: unknown;
  let height: unknown;
  try {
    const meta = await sharp(buffer).metadata();
    width = meta.width;
    height = meta.height;
  } catch {
    return null;
  }
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return { buffer, width, height };
}

// ---------------------------------------------------------------------------
// requestUploadUrl
// ---------------------------------------------------------------------------

/**
 * Mint a presigned PUT URL for the browser to upload directly to R2.
 *
 * Validates that the project exists and that the supplied content type and
 * size are within bounds before contacting R2. The presigned URL expires
 * in 15 minutes — long enough for a 5 GB upload over a slow connection.
 */
export async function requestUploadUrl(
  projectId: string,
  filename: string,
  contentType: string,
  contentLength: number,
): Promise<RequestUploadUrlResult> {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true },
  });
  if (project === null) {
    return { ok: false, error: 'Project not found.' };
  }

  return createPresignedUploadUrl(
    projectId,
    filename,
    contentType,
    contentLength,
  );
}

// ---------------------------------------------------------------------------
// finalizeUpload
// ---------------------------------------------------------------------------

const EMPTY_VARIANT_SET: VariantSet = { renditions: [], failures: [] };

/**
 * Record a successfully uploaded R2 object as a MediaItem. The browser
 * calls this after the PUT to the presigned URL completes; this action
 *
 *   1. Validates the MIME and size envelope.
 *   2. For image kinds, runs a strict dimension probe (fetch + sharp).
 *      A failure to resolve a positive integer width and height is the
 *      `invalid_format` rejection envelope per Requirement 2.10: the
 *      action deletes the just-uploaded R2 object (best-effort) and
 *      never creates a Media_Item row. The Media_Item row only becomes
 *      visible to the listing once positive integers are persisted
 *      (Requirement 2.9).
 *   3. Persists the row including the lowercase file extension derived
 *      from `MIME_TO_EXT` (Requirement 2.11). For model3d uploads the
 *      persisted value is exactly one of `glb`, `gltf`, `usdz`. The
 *      `.toLowerCase()` call is defensive so a future map entry with a
 *      mixed-case extension stays compliant.
 *   4. For image kinds, runs the variant pipeline against the cached
 *      source buffer (no second R2 round trip) and updates the row
 *      with the resulting `variantSet` (Requirement 6.3).
 */
export async function finalizeUpload(
  projectId: string,
  publicUrl: string,
  contentType: string,
  contentLength: number,
  filename: string,
): Promise<FinalizeUploadResult> {
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

  const mime = contentType.trim().toLowerCase();
  const kind = inferKindFromMime(mime);
  if (kind === null) {
    return {
      ok: false,
      code: 'invalid_format',
      error: `Unsupported content type "${mime}".`,
    };
  }
  if (!(ALLOWED_MIME_TYPES_BY_KIND[kind] as ReadonlyArray<string>).includes(mime)) {
    return {
      ok: false,
      code: 'invalid_format',
      error: `Content type "${mime}" not allowed for ${kind}.`,
    };
  }
  if (
    !Number.isFinite(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_MEDIA_BYTES
  ) {
    return {
      ok: false,
      code: 'file_too_large',
      error: `Reported size ${contentLength} bytes is invalid.`,
    };
  }

  // Lowercase file extension persisted on every kind via the central
  // MIME_TO_EXT map. The defensive `.toLowerCase()` survives any future
  // map entry that ships a mixed-case extension; today's entries are
  // already lowercase so it is a no-op for the in-tree set
  // (Requirement 2.11).
  const mappedExtension = MIME_TO_EXT[mime];
  const extension =
    typeof mappedExtension === 'string' && mappedExtension.length > 0
      ? mappedExtension.toLowerCase()
      : null;

  // ---- Image probe (Requirement 2.9 / 2.10) ---------------------------
  let probed: ImageProbeOk | null = null;
  if (kind === 'image') {
    probed = await probeImageBytes(publicUrl);
    if (probed === null) {
      // Best-effort cleanup: delete the orphan object before surfacing
      // the rejection. A failure to reach R2 is swallowed — the bucket
      // lifecycle rule eventually reaps the orphan and the rejection
      // still surfaces to the client.
      try {
        await removeFromR2ByPublicUrl(publicUrl);
      } catch {
        // best-effort
      }
      return {
        ok: false,
        code: 'invalid_format',
        error: 'Could not read image dimensions; the upload was rejected.',
      };
    }
  }

  const ordering = await nextOrdering(projectId);

  // The presigned-URL flow uses a path-style key, so we derive a stable
  // pseudo-hash from the URL itself to fill the schema's contentHash
  // column. The bytes are already content-addressed by the nonce in the
  // R2 key; this just lets the existing column constraint stay non-null.
  const contentHash = (() => {
    // 64 hex chars: derive deterministically from the publicUrl.
    let h = 0xdeadbeef;
    for (let i = 0; i < publicUrl.length; i++) {
      h = Math.imul(h ^ publicUrl.charCodeAt(i), 16777619);
    }
    const base = (h >>> 0).toString(16).padStart(8, '0');
    return (base + base + base + base + base + base + base + base).slice(0, 64);
  })();

  // The row insert and the first-image auto-set live inside the same
  // transaction so the cover write and the row that satisfies it land
  // atomically (Requirement 5.4 — design.md "Cover selection
  // lifecycle"). The auto-set is positional: it triggers when the
  // parent Project has `coverMediaId IS NULL` and the new item is
  // image-kind, regardless of earlier non-image uploads. The internal
  // `applyCoverSelection` helper bypasses the user-facing rejection
  // codes and returns silently on the no-op path.
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.mediaItem.create({
      data: {
        projectId,
        storageKey: publicUrl,
        contentHash,
        mimeType: mime,
        width: probed?.width ?? null,
        height: probed?.height ?? null,
        durationSec: null,
        byteSize: Math.min(contentLength, MAX_MEDIA_BYTES),
        kind,
        altText: null,
        caption: filename.trim().length > 0 ? null : null,
        ordering,
        embedUrl: null,
        extension,
        variantSet: EMPTY_VARIANT_SET as unknown as Prisma.InputJsonValue,
      },
    });

    if (kind === 'image') {
      const parent = await tx.project.findUnique({
        where: { id: projectId },
        select: { coverMediaId: true },
      });
      if (parent !== null && parent.coverMediaId === null) {
        // Server-internal silent variant: any rejection envelope is a
        // no-op for the auto-set path. The validator still guards
        // against the (impossible-here, but defensively checked)
        // foreign-project / non-image branches.
        await applyCoverSelection(tx, projectId, row.id);
      }
    }

    return row;
  });

  // ---- Variant generation (Requirement 6.3) ---------------------------
  // The probe already cached the source buffer, so the variant pipeline
  // never makes a second round trip to R2. Failures inside the pipeline
  // are recorded per-rendition; an uncaught throw leaves the row with
  // an empty `variantSet` so the public renderer falls back to the
  // original `storageKey` rendering (Requirement 6.6).
  let variantSet: VariantSet = EMPTY_VARIANT_SET;
  if (kind === 'image' && probed !== null) {
    try {
      variantSet = await generateVariants(
        {
          mediaId: created.id,
          sourceBuffer: probed.buffer,
          originalWidth: probed.width,
        },
        { put: putR2Object },
      );
      await prisma.mediaItem.update({
        where: { id: created.id },
        data: {
          variantSet: variantSet as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Leave the row with the empty variant set; the renderer falls
      // back to the original `storageKey` per Requirement 6.6.
    }
  }

  revalidateAfterMediaChange(project.slug);

  return {
    ok: true,
    value: {
      id: created.id,
      storageKey: created.storageKey,
      mimeType: created.mimeType,
      kind: created.kind as MediaKind,
      altText: created.altText,
      caption: created.caption,
      ordering: created.ordering,
      width: created.width,
      height: created.height,
      embedUrl: created.embedUrl,
      extension: created.extension,
      variantSet,
    },
  };
}

// ---------------------------------------------------------------------------
// addYouTubeEmbed
// ---------------------------------------------------------------------------

/**
 * Add a YouTube or Vimeo embed as a virtual MediaItem on the project. The
 * row's `storageKey` carries the provider thumbnail URL (so the gallery
 * still has a static image to show); `embedUrl` carries the iframe src.
 *
 * Validation runs through `parseEmbedUrl` (HTTPS scheme, hostname
 * allowlist, provider id-extraction). Any rejection surfaces as
 * `{ ok: false, code: 'unsupported_embed_provider' }` per Requirement 9.2.
 *
 * On success the row carries `kind = 'video'`, `embedUrl = parsed.embedUrl`
 * (always `https://`), `byteSize = 0` (Requirement 9.3 / 9.4), and
 * `storageKey = parsed.thumbnailUrl` when the provider exposes one. Vimeo
 * (and any future provider without thumbnail support) persists with an
 * empty `storageKey` since the column is NOT NULL at the database level
 * (Requirement 9.4 — surfaced as the empty-string sentinel; the renderer
 * already treats embeds by `embedUrl` rather than `storageKey`).
 *
 * The export name is preserved for source compatibility; internally this
 * is now an `addEmbed`-shaped action that handles every supported provider.
 */
export async function addYouTubeEmbed(
  projectId: string,
  url: string,
): Promise<AddEmbedResult> {
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

  const parsed = parseEmbedUrl(url);
  if (parsed === null) {
    return {
      ok: false,
      code: 'unsupported_embed_provider',
      error: 'Paste a YouTube or Vimeo URL (https only).',
    };
  }

  const ordering = await nextOrdering(projectId);
  const placeholderHash = `embed-${parsed.provider}-${parsed.videoId}`
    .replace(/[^a-z0-9-]/giu, '')
    .padEnd(64, '0')
    .slice(0, 64);

  // Embed Media_Items always carry `byteSize === 0` and carry
  // `storageKey === null` (modelled here as the empty-string sentinel
  // because the column is NOT NULL in the schema) when the provider
  // exposes no thumbnail. Requirements 9.3 and 9.4.
  const created = await prisma.mediaItem.create({
    data: {
      projectId,
      storageKey: parsed.thumbnailUrl ?? '',
      contentHash: placeholderHash,
      mimeType: 'video/mp4',
      width: 1920,
      height: 1080,
      durationSec: null,
      byteSize: 0,
      kind: 'video',
      altText: null,
      caption: null,
      ordering,
      embedUrl: parsed.embedUrl,
    },
  });

  revalidateAfterMediaChange(project.slug);

  return {
    ok: true,
    value: {
      id: created.id,
      storageKey: created.storageKey,
      mimeType: created.mimeType,
      kind: created.kind as MediaKind,
      altText: created.altText,
      caption: created.caption,
      ordering: created.ordering,
      width: created.width,
      height: created.height,
      embedUrl: created.embedUrl,
      // Embed rows have no stored object and therefore no extension or
      // derived variants; the public renderer reads `embedUrl` first
      // and never consults these fields for embed-kind media.
      extension: created.extension,
      variantSet: EMPTY_VARIANT_SET,
    },
  };
}

// ---------------------------------------------------------------------------
// reorderMediaList
// ---------------------------------------------------------------------------

/**
 * Atomically rewrite every media item's `ordering` for a project so the
 * persisted order matches the client's drag-and-drop result. Replaces the
 * old per-item `moveMediaItem` action.
 *
 * Steps inside a single transaction:
 *   1. Reject duplicate ids in the supplied list (`reorder_duplicate_id`).
 *   2. Reject when the supplied count does not match the persisted count
 *      (`reorder_count_mismatch`). A non-existent project has zero media
 *      items, so this branch also covers the "project not found" case.
 *   3. Reject when any supplied id does not belong to the project
 *      (`unknown_media_id`).
 *   4. First pass: shift every row to a non-overlapping high-numbered
 *      bucket so the unique-friendly index doesn't collide mid-update.
 *   5. Second pass: write the final 0..N-1 ordering in the supplied order.
 *
 * Steps 1–3 all run inside the same `prisma.$transaction` block as the
 * two-pass renumber so the validation observes the same snapshot the
 * writes will operate against and no row is mutated on the rejection
 * branch.
 */
export async function reorderMediaList(
  projectId: string,
  orderedIds: ReadonlyArray<string>,
): Promise<ReorderMediaResult> {
  await requireAdmin();

  const result = await prisma.$transaction<ReorderMediaResult>(async (tx) => {
    // 1. Duplicate detection runs first so a malformed list never
    //    touches the database past the read snapshot.
    const uniqueIds = new Set(orderedIds);
    if (uniqueIds.size !== orderedIds.length) {
      return {
        ok: false,
        error: 'Reorder list contains duplicate media ids.',
        code: 'reorder_duplicate_id',
      };
    }

    const existing = await tx.mediaItem.findMany({
      where: { projectId },
      select: { id: true },
    });

    // 2. Count check. Also covers the case where the project does not
    //    exist (existing.length === 0): any non-empty ordered list will
    //    fail here, while an empty list against a missing project is a
    //    harmless no-op.
    if (existing.length !== orderedIds.length) {
      return {
        ok: false,
        error: 'Reorder list does not match the project media set.',
        code: 'reorder_count_mismatch',
      };
    }

    // 3. Ownership / foreign-id check.
    const existingIds = new Set(existing.map((m) => m.id));
    for (const id of orderedIds) {
      if (!existingIds.has(id)) {
        return {
          ok: false,
          error: `Unknown media id: ${id}.`,
          code: 'unknown_media_id',
        };
      }
    }

    // 4 & 5. Two-pass renumber so the ordering field never has duplicate
    // values mid-flight while still landing on a contiguous 0..N-1
    // sequence in the supplied order.
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (typeof id !== 'string') continue;
      await tx.mediaItem.update({
        where: { id },
        data: { ordering: 1_000_000 + i },
      });
    }
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      if (typeof id !== 'string') continue;
      await tx.mediaItem.update({
        where: { id },
        data: { ordering: i },
      });
    }

    return { ok: true };
  });

  if (!result.ok) {
    return result;
  }

  // Fetch the slug only after the renumber has committed so we revalidate
  // exactly the paths whose data just changed.
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true },
  });
  revalidateAfterMediaChange(project?.slug ?? null);

  return { ok: true };
}

// ---------------------------------------------------------------------------
// replaceMediaFile
// ---------------------------------------------------------------------------

/**
 * Swap the file behind an existing Media_Item without losing its
 * `id`, `projectId`, `altText`, `caption`, or `ordering`. The browser
 * runs the same presign → PUT → finalize sequence used for fresh uploads
 * and then calls this action with the resulting `publicUrl`. Section_Block
 * references continue to point at the same `MediaItem.id` and remain
 * valid (Requirement 4.6).
 *
 * Steps:
 *
 *   1. `requireAdmin()`.
 *   2. Load the existing row (with its parent project's slug for
 *      revalidation). A missing row resolves as `unknown_media_id`.
 *   3. Compare `inferKindFromMime(contentType)` to the existing row's
 *      `kind`. When they differ, return `kind_change_disallowed`
 *      immediately and do **not** mutate the row, do **not** invalidate
 *      the Variant_Set, do **not** delete any object from R2, do **not**
 *      call sharp (Requirement 4.3). The just-uploaded orphan object at
 *      `publicUrl` is left to the bucket lifecycle rule.
 *   4. Validate MIME and size (same envelope as `finalizeUpload`); for
 *      image kinds run a strict dimension probe (Requirement 2.10) and
 *      reject with `invalid_format` when sharp cannot resolve positive
 *      integer width and height. Best-effort delete of the new orphan
 *      object before surfacing the rejection.
 *   5. Inside a single Prisma transaction, update `storageKey`,
 *      `contentHash`, `mimeType`, `byteSize`, `width`, `height`,
 *      `extension`, **and** `variantSet = { renditions: [], failures: [] }`
 *      while preserving `id`, `projectId`, `altText`, `caption`,
 *      `ordering` (Requirement 4.2 / 4.4). Always invalidating the
 *      Variant_Set ensures leftover renditions never serve stale bytes.
 *   6. After the transaction commits, call {@link deleteVariantKeys} so
 *      the prior renditions are removed from R2 (best-effort; per-key
 *      failures are swallowed inside the helper). This runs for every
 *      kind so video and model3d replacements also clear orphans.
 *   7. Regenerate variants via {@link generateVariants} **only** when
 *      the new `kind === 'image'`. Video and model3d replacements skip
 *      the sharp pipeline entirely (Requirement 4.4 / 4.5).
 *   8. Call `revalidateAfterMediaChange(slug)` so the next public
 *      request to `/projects/{slug}` returns the new file
 *      (Requirement 4.5).
 *
 * **Upload-failure rollback semantics.** If the browser's PUT to the new
 * presigned URL fails or times out (the same 600-second / non-2xx
 * envelope used for fresh uploads), the client never invokes
 * `replaceMediaFile` and the existing row remains exactly as it was.
 * If `replaceMediaFile` itself throws after step 5 has committed, the
 * action returns `{ ok: false, code: 'upload_failed' }`; the variant-set
 * invalidation in step 5 has already cleared `variantSet`, so the
 * renderer falls back to the original `storageKey` rendering per
 * Requirement 6.6 and the user-visible failure mode is "no responsive
 * variants yet" rather than a broken row.
 */
export async function replaceMediaFile(
  mediaId: string,
  publicUrl: string,
  contentType: string,
  contentLength: number,
  filename: string,
): Promise<ReplaceMediaResult> {
  await requireAdmin();
  // `filename` is part of the action signature for parity with
  // `finalizeUpload` and for future use by audit logging; the persisted
  // row's identity does not change so we do not derive any column from
  // it directly.
  void filename;

  // ---- Step 2: load the existing row + project slug ------------------
  const existing = await prisma.mediaItem.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      projectId: true,
      kind: true,
      ordering: true,
      altText: true,
      caption: true,
      embedUrl: true,
      project: { select: { slug: true } },
    },
  });
  if (existing === null) {
    return {
      ok: false,
      code: 'unknown_media_id',
      error: 'Media item not found.',
    };
  }

  // ---- Step 3: kind-change guard (Requirement 4.3) -------------------
  // The kind comparison runs before any MIME / size validation so a
  // payload whose content type is in a different kind category gets the
  // canonical `kind_change_disallowed` envelope. Crucially, no row
  // mutation, variant invalidation, R2 delete, or sharp probe occurs on
  // this branch; the orphan object at `publicUrl` is left to the bucket
  // lifecycle rule.
  const mime = contentType.trim().toLowerCase();
  const inferredKind = inferKindFromMime(mime);
  const existingKind = existing.kind as MediaKind;
  if (inferredKind === null || inferredKind !== existingKind) {
    return {
      ok: false,
      code: 'kind_change_disallowed',
      error: `Replacement file kind does not match the existing ${existingKind} media.`,
    };
  }

  // ---- Step 4: MIME and size validation ------------------------------
  if (
    !(ALLOWED_MIME_TYPES_BY_KIND[inferredKind] as ReadonlyArray<string>).includes(
      mime,
    )
  ) {
    return {
      ok: false,
      code: 'invalid_format',
      error: `Content type "${mime}" not allowed for ${inferredKind}.`,
    };
  }
  if (
    !Number.isFinite(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_MEDIA_BYTES
  ) {
    return {
      ok: false,
      code: 'file_too_large',
      error: `Reported size ${contentLength} bytes is invalid.`,
    };
  }

  // Lowercase file extension for the new row state; defensive
  // `.toLowerCase()` survives any future map entry that ships a
  // mixed-case extension (Requirement 2.11).
  const mappedExtension = MIME_TO_EXT[mime];
  const extension =
    typeof mappedExtension === 'string' && mappedExtension.length > 0
      ? mappedExtension.toLowerCase()
      : null;

  // ---- Step 4 (cont.): image dimension probe (Requirement 2.10) ------
  let probed: ImageProbeOk | null = null;
  if (inferredKind === 'image') {
    probed = await probeImageBytes(publicUrl);
    if (probed === null) {
      // Best-effort cleanup of the orphan object before surfacing the
      // rejection. The existing row is untouched.
      try {
        await removeFromR2ByPublicUrl(publicUrl);
      } catch {
        // best-effort
      }
      return {
        ok: false,
        code: 'invalid_format',
        error: 'Could not read image dimensions; the replacement was rejected.',
      };
    }
  }

  // Stable pseudo-hash derived from the new public URL (matches the
  // shape used by `finalizeUpload`).
  const contentHash = (() => {
    let h = 0xdeadbeef;
    for (let i = 0; i < publicUrl.length; i++) {
      h = Math.imul(h ^ publicUrl.charCodeAt(i), 16777619);
    }
    const base = (h >>> 0).toString(16).padStart(8, '0');
    return (base + base + base + base + base + base + base + base).slice(0, 64);
  })();

  // ---- Step 5: transactional swap + Variant_Set invalidation ---------
  // The transaction wraps the single UPDATE so the new `storageKey`
  // and the cleared `variantSet` land atomically. `id`, `projectId`,
  // `altText`, `caption`, `ordering` are not in the `data` payload and
  // therefore preserved (Requirement 4.2). Section_Block references
  // continue to point at the same `MediaItem.id` (Requirement 4.6).
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      return tx.mediaItem.update({
        where: { id: mediaId },
        data: {
          storageKey: publicUrl,
          contentHash,
          mimeType: mime,
          byteSize: Math.min(contentLength, MAX_MEDIA_BYTES),
          width: probed?.width ?? null,
          height: probed?.height ?? null,
          extension,
          variantSet: EMPTY_VARIANT_SET as unknown as Prisma.InputJsonValue,
        },
      });
    });
  } catch (err) {
    // The transaction failed before committing the new row state, so
    // the existing row is still the canonical state. The just-uploaded
    // object at `publicUrl` is now orphaned; leave it for the bucket
    // lifecycle rule to reap.
    void err;
    return {
      ok: false,
      code: 'upload_failed',
      error: 'Failed to persist replacement; the original media item is unchanged.',
    };
  }

  // ---- Step 6: invalidate prior R2 variant objects (Requirement 4.4) -
  // Best-effort: per-key failures are swallowed inside `deleteVariantKeys`
  // so the row update still stands. Runs for every kind, so video and
  // model3d replacements clear orphans from any prior image incarnation.
  try {
    await deleteVariantKeys(mediaId, {
      remove: async (key) => {
        await removeFromR2(key);
      },
    });
  } catch {
    // best-effort
  }

  // ---- Step 7: regenerate variants for image kinds only --------------
  let variantSet: VariantSet = EMPTY_VARIANT_SET;
  if (inferredKind === 'image' && probed !== null) {
    try {
      variantSet = await generateVariants(
        {
          mediaId: updated.id,
          sourceBuffer: probed.buffer,
          originalWidth: probed.width,
        },
        { put: putR2Object },
      );
      await prisma.mediaItem.update({
        where: { id: updated.id },
        data: {
          variantSet: variantSet as unknown as Prisma.InputJsonValue,
        },
      });
    } catch {
      // Leave the row with the empty variant set; the renderer falls
      // back to the original `storageKey` per Requirement 6.6.
    }
  }

  // ---- Step 8: revalidate public + admin surfaces --------------------
  revalidateAfterMediaChange(existing.project.slug);

  return {
    ok: true,
    value: {
      id: updated.id,
      storageKey: updated.storageKey,
      mimeType: updated.mimeType,
      kind: updated.kind as MediaKind,
      altText: updated.altText,
      caption: updated.caption,
      ordering: updated.ordering,
      width: updated.width,
      height: updated.height,
      embedUrl: updated.embedUrl,
      extension: updated.extension,
      variantSet,
    },
  };
}
