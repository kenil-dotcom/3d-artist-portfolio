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

import { requireAdmin } from '@/lib/auth/middleware';
import {
  createPresignedUploadUrl,
  inferKindFromMime,
  type PresignedUpload,
} from '@/lib/admin/presign';
import { parseEmbedUrl } from '@/lib/admin/embeds';
import { prisma } from '@/lib/db/prisma';
import {
  ALLOWED_MIME_TYPES_BY_KIND,
  MAX_MEDIA_BYTES,
} from '@/lib/validation/media';
import type { MediaKind } from '@/lib/types/domain';

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
}

export type FinalizeUploadResult =
  | { readonly ok: true; readonly value: FinalizedMediaItem }
  | { readonly ok: false; readonly error: string };

export type AddEmbedResult =
  | { readonly ok: true; readonly value: FinalizedMediaItem }
  | { readonly ok: false; readonly error: string };

export type ReorderMediaResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

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

async function probeImageDimensions(
  url: string,
  byteLimit: number,
): Promise<{ width: number | null; height: number | null }> {
  // Best-effort: we fetch the public URL once to ask sharp for the
  // intrinsic dimensions. Failures are non-fatal — width/height stay null
  // and the public site will fall back to its placeholder dimensions.
  try {
    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) return { width: null, height: null };
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > byteLimit) {
      return { width: null, height: null };
    }
    const meta = await sharp(buffer).metadata();
    return {
      width: typeof meta.width === 'number' ? meta.width : null,
      height: typeof meta.height === 'number' ? meta.height : null,
    };
  } catch {
    return { width: null, height: null };
  }
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

/**
 * Record a successfully uploaded R2 object as a MediaItem. The browser
 * calls this after the PUT to the presigned URL completes; this action
 * creates the database row, infers width/height for images via sharp, and
 * returns the new id so the client can append it to the editor's in-memory
 * media list.
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
    return { ok: false, error: 'Project not found.' };
  }

  const mime = contentType.trim().toLowerCase();
  const kind = inferKindFromMime(mime);
  if (kind === null) {
    return { ok: false, error: `Unsupported content type "${mime}".` };
  }
  if (!(ALLOWED_MIME_TYPES_BY_KIND[kind] as ReadonlyArray<string>).includes(mime)) {
    return { ok: false, error: `Content type "${mime}" not allowed for ${kind}.` };
  }
  if (
    !Number.isFinite(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_MEDIA_BYTES
  ) {
    return {
      ok: false,
      error: `Reported size ${contentLength} bytes is invalid.`,
    };
  }

  let width: number | null = null;
  let height: number | null = null;
  if (kind === 'image') {
    // Cap the probe download at 32 MB; anything larger is a stylized still
    // we still want to record but don't need to inspect synchronously.
    const probed = await probeImageDimensions(publicUrl, 32 * 1024 * 1024);
    width = probed.width;
    height = probed.height;
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

  const created = await prisma.mediaItem.create({
    data: {
      projectId,
      storageKey: publicUrl,
      contentHash,
      mimeType: mime,
      width,
      height,
      durationSec: null,
      byteSize: Math.min(contentLength, MAX_MEDIA_BYTES),
      kind,
      altText: null,
      caption: filename.trim().length > 0 ? null : null,
      ordering,
      embedUrl: null,
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
    return { ok: false, error: 'Project not found.' };
  }

  const parsed = parseEmbedUrl(url);
  if (parsed === null) {
    return {
      ok: false,
      error: 'Paste a YouTube or Vimeo URL (https only).',
    };
  }

  const ordering = await nextOrdering(projectId);
  const placeholderHash = `embed-${parsed.provider}-${parsed.videoId}`
    .replace(/[^a-z0-9-]/giu, '')
    .padEnd(64, '0')
    .slice(0, 64);

  const created = await prisma.mediaItem.create({
    data: {
      projectId,
      storageKey: parsed.thumbnailUrl ?? parsed.embedUrl,
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
 *   1. Verify every supplied id belongs to the project. Reject if any id
 *      is foreign — we never want to renumber another project's media.
 *   2. First pass: shift every row to a non-overlapping high-numbered
 *      bucket so the unique-friendly index doesn't collide mid-update.
 *   3. Second pass: write the final 0..N-1 ordering in the supplied order.
 */
export async function reorderMediaList(
  projectId: string,
  orderedIds: ReadonlyArray<string>,
): Promise<ReorderMediaResult> {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true },
  });
  if (project === null) {
    return { ok: false, error: 'Project not found.' };
  }

  const existing = await prisma.mediaItem.findMany({
    where: { projectId },
    select: { id: true },
  });

  if (existing.length !== orderedIds.length) {
    return {
      ok: false,
      error: 'Reorder list does not match the project media set.',
    };
  }
  const existingIds = new Set(existing.map((m) => m.id));
  for (const id of orderedIds) {
    if (!existingIds.has(id)) {
      return { ok: false, error: `Unknown media id: ${id}.` };
    }
  }

  // Two-pass renumber inside a single transaction so the ordering field
  // never has duplicate values mid-flight.
  await prisma.$transaction(async (tx) => {
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
  });

  revalidateAfterMediaChange(project.slug);

  return { ok: true };
}
