'use server';

/**
 * Server actions for the project editor.
 *
 * Every mutation:
 *   1. Calls `requireAdmin()` to assert the session.
 *   2. Validates input via the pure validators in `lib/validation/*`.
 *   3. Persists with Prisma.
 *   4. Calls `revalidatePath()` for both the admin route and the public
 *      project URL so the public site reflects changes immediately.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/middleware';
import { applyCoverSelection, type CoverErrorCode } from '@/lib/admin/cover';
import { removeFromR2, storeProjectMedia } from '@/lib/admin/uploads';
import { deleteVariantKeys } from '@/lib/admin/variants';
import { slugify } from '@/lib/admin/slug';
import { prisma } from '@/lib/db/prisma';
import type {
  CategoryId,
  MediaItem,
  MediaItemId,
  Project,
  ProjectId,
  ProjectStatus,
  Slug,
  TagId,
} from '@/lib/types/domain';
import {
  SLUG_PATTERN,
  validateProjectInput,
  validatePublishable,
  normalizeSoftwareList,
  RULE_ORDER,
  SOFTWARE_ENTRY_MAX_LENGTH,
  SOFTWARE_ENTRY_MIN_LENGTH,
  SOFTWARE_USED_MAX,
  TITLE_MAX_LENGTH,
} from '@/lib/validation/project';
import { normalizeAltText, normalizeCaption } from '@/lib/validation/media';
import {
  applyStatusTransition,
  parseScheduledAt,
} from '@/lib/validation/schedule';

// ---------------------------------------------------------------------------
// Action result shape
// ---------------------------------------------------------------------------

export interface SaveProjectState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message: string | null;
  /** Per-field error messages keyed by field path. */
  readonly errors: Readonly<Record<string, string>>;
}

export const INITIAL_SAVE_STATE: SaveProjectState = {
  status: 'idle',
  message: null,
  errors: {},
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function brand<B>(value: string): B {
  return value as unknown as B;
}

function parseFeaturedOrder(raw: string | null): number | null {
  if (raw === null || raw.trim().length === 0) return null;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 11) return null;
  return n;
}

function parseStringList(formData: FormData, key: string): ReadonlyArray<string> {
  const all = formData.getAll(key);
  return all
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

async function reloadProjectAsDomain(id: string): Promise<Project | null> {
  const row = await prisma.project.findUnique({
    where: { id },
    include: {
      mediaItems: { orderBy: { ordering: 'asc' } },
      tags: { select: { tagId: true } },
    },
  });
  if (row === null) return null;

  const mediaItems: ReadonlyArray<MediaItem> = row.mediaItems.map((m) => ({
    id: brand<MediaItemId>(m.id),
    projectId: brand<ProjectId>(m.projectId),
    ref: {
      storageKey: m.storageKey,
      contentHash: brand(m.contentHash),
      mimeType: m.mimeType as MediaItem['ref']['mimeType'],
      width: m.width,
      height: m.height,
      durationSec: m.durationSec,
      byteSize: m.byteSize,
    },
    kind: m.kind as MediaItem['kind'],
    altText: m.altText,
    caption: m.caption,
    ordering: m.ordering,
    captionsRef: null,
    transcript: m.transcript,
    embedUrl: m.embedUrl,
    extension: m.extension,
    variantSet: (m.variantSet as unknown as MediaItem['variantSet']) ?? {
      renditions: [],
      failures: [],
    },
  }));

  return {
    id: brand<ProjectId>(row.id),
    slug: brand<Slug>(row.slug),
    title: row.title,
    description: row.description,
    categoryId: brand<CategoryId>(row.categoryId),
    tagIds: row.tags.map((t) => brand<TagId>(t.tagId)),
    coverMediaId:
      row.coverMediaId === null ? null : brand<MediaItemId>(row.coverMediaId),
    mediaItems,
    softwareUsed: [...row.softwareUsed],
    creationDate: brand(
      row.creationDate.toISOString().slice(0, 10),
    ),
    publishedAt: row.publishedAt === null ? null : brand(row.publishedAt.toISOString()),
    scheduledAt: row.scheduledAt === null ? null : brand(row.scheduledAt.toISOString()),
    status: row.status as ProjectStatus,
    featuredOrder: row.featuredOrder,
    createdAt: brand(row.createdAt.toISOString()),
    updatedAt: brand(row.updatedAt.toISOString()),
  };
}

/**
 * Wrap each `revalidatePath` call in try/catch and collect failures so a
 * single bad path does not abort the rest of the revalidation sweep, and
 * so the action boundary can surface the failures as a non-blocking
 * warning banner per Requirement 14.5.
 *
 * The persisted database mutation is **not** rolled back when a
 * revalidation fails — the database is the canonical source of truth,
 * and a failed `revalidatePath` only delays the public surface from
 * picking up the change until the next ISR window.
 *
 * Each warning is shaped as `${path}: ${reason}` so the banner can list
 * the offending path inline.
 *
 * `async` because every export from a `'use server'` module must be an
 * async function. `revalidatePath` itself is synchronous, so the body
 * never awaits anything.
 */
export async function revalidatePathsCollectingWarnings(
  paths: ReadonlyArray<string>,
): Promise<string[]> {
  const warnings: string[] = [];
  for (const path of paths) {
    try {
      revalidatePath(path);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      warnings.push(`${path}: ${reason}`);
    }
  }
  return warnings;
}

/**
 * Revalidate every admin and public surface affected by a Project
 * mutation. Returns the list of failure messages produced by
 * `revalidatePathsCollectingWarnings` so callers (notably the
 * section-block server actions) can surface them on their `Result.value`
 * envelope. Existing call sites that ignore the return value continue to
 * work unchanged.
 *
 * Paths revalidated, per Requirement 14.1–14.3 and design.md "Cache
 * revalidation":
 *   - `/admin/projects` (admin index)
 *   - `/admin`          (admin dashboard featured grid)
 *   - `/`               (home page featured grid)
 *   - `/gallery`        (public gallery index)
 *   - `/projects/{slug}` (public detail page) when the slug is non-empty
 */
export async function revalidateProjectPaths(
  slug: string | null,
): Promise<string[]> {
  const paths: string[] = ['/admin/projects', '/admin', '/', '/gallery'];
  if (slug !== null && slug.length > 0) {
    paths.push(`/projects/${slug}`);
  }
  return revalidatePathsCollectingWarnings(paths);
}

// ---------------------------------------------------------------------------
// Save (create or update)
// ---------------------------------------------------------------------------

export async function saveProject(
  projectId: string | null,
  _prev: SaveProjectState,
  formData: FormData,
): Promise<SaveProjectState> {
  await requireAdmin();

  const titleRaw = (formData.get('title') ?? '').toString().trim();
  const slugRaw = (formData.get('slug') ?? '').toString().trim();
  const descriptionRaw = (formData.get('description') ?? '').toString();
  const categoryId = (formData.get('categoryId') ?? '').toString();
  const tagIds = parseStringList(formData, 'tagIds');
  const softwareRaw = parseStringList(formData, 'softwareUsed');
  const creationDate = (formData.get('creationDate') ?? '').toString();
  const statusRaw = (formData.get('status') ?? 'draft').toString();
  // Tri-state status (Requirement 7.1). Any unknown string falls back to
  // `draft` so a malformed POST never silently flips the project to a
  // published or scheduled state.
  const status: ProjectStatus =
    statusRaw === 'published'
      ? 'published'
      : statusRaw === 'scheduled'
        ? 'scheduled'
        : 'draft';
  const scheduledAtRaw = (formData.get('scheduledAt') ?? '').toString();
  const featuredOrder = parseFeaturedOrder(
    (formData.get('featuredOrder') ?? '').toString(),
  );

  // Default to a slug derived from the title when the field is blank.
  const slugCandidate =
    slugRaw.length === 0
      ? slugify(titleRaw.length === 0 ? 'untitled' : titleRaw)
      : slugRaw;

  const errors: Record<string, string> = {};

  if (titleRaw.length === 0) {
    errors['title'] = 'Title is required.';
  } else if (titleRaw.length > TITLE_MAX_LENGTH) {
    errors['title'] = `Title must be at most ${TITLE_MAX_LENGTH} characters.`;
  }

  if (!SLUG_PATTERN.test(slugCandidate) || slugCandidate.length === 0) {
    errors['slug'] =
      'Slug must contain only lowercase letters, numbers, and single hyphens.';
  }

  if (categoryId.length === 0) {
    errors['categoryId'] = 'Pick a category.';
  }

  // Normalise the software list (trim + case-insensitive dedupe). This runs
  // before `validateProjectInput` so duplicate / oversize lists are caught
  // and the validator sees the canonical form (Requirements 11.3–11.6).
  const softwareNormalisation = normalizeSoftwareList(softwareRaw);
  if (!softwareNormalisation.ok) {
    errors['softwareUsed'] =
      softwareNormalisation.code === 'too_many_software_entries'
        ? `Software list may contain at most ${SOFTWARE_USED_MAX} entries.`
        : `Each software entry must be ${SOFTWARE_ENTRY_MIN_LENGTH}–${SOFTWARE_ENTRY_MAX_LENGTH} characters after trimming.`;
  }
  const softwareUsed: ReadonlyArray<string> = softwareNormalisation.ok
    ? softwareNormalisation.value
    : softwareRaw;

  // Validate against the pure validator next so length / date / enum
  // errors surface from the same source the public site uses.
  const validation = validateProjectInput(
    {
      title: titleRaw,
      description: descriptionRaw,
      slug: brand<Slug>(slugCandidate),
      categoryId: brand<CategoryId>(categoryId),
      tagIds: tagIds as ReadonlyArray<TagId>,
      coverMediaId: null,
      softwareUsed,
      creationDate: brand(creationDate),
      status,
    },
    new Date(),
  );
  if (!validation.ok) {
    for (const err of validation.errors) {
      if (errors[err.field] === undefined) {
        errors[err.field] = err.message;
      }
    }
  }

  // Parse `scheduledAt` when the admin selected the `scheduled` tri-state
  // option (Requirements 7.2, 7.3, 7.4). Both bounds — past timestamps
  // and timestamps more than 365 days ahead — collapse onto a single
  // `scheduled_at_in_past` rejection code per `parseScheduledAt`'s
  // contract; missing / unparseable values reject with
  // `scheduled_at_missing`. Errors are attributed to the `scheduledAt`
  // field so the editor surfaces them inline. On rejection the existing
  // per-field-errors short-circuit below leaves the persisted Project
  // values unchanged — no column write happens before the early return.
  let parsedScheduledAt: Date | null = null;
  if (status === 'scheduled') {
    const parsed = parseScheduledAt(scheduledAtRaw, new Date());
    if (!parsed.ok) {
      if (errors['scheduledAt'] === undefined) {
        errors['scheduledAt'] =
          parsed.code === 'scheduled_at_missing'
            ? 'Pick a publish date.'
            : 'Pick a date between now and 365 days from now.';
      }
    } else {
      parsedScheduledAt = parsed.value;
    }
  }

  if (Object.keys(errors).length > 0) {
    return {
      status: 'error',
      message: 'Please review the highlighted fields.',
      errors,
    };
  }

  // Slug uniqueness check.
  const existing = await prisma.project.findUnique({
    where: { slug: slugCandidate },
    select: { id: true },
  });
  if (existing !== null && existing.id !== projectId) {
    return {
      status: 'error',
      message: null,
      errors: { slug: 'This slug is already used by another project.' },
    };
  }

  const data = {
    slug: slugCandidate,
    title: titleRaw,
    description: descriptionRaw,
    categoryId,
    softwareUsed: [...softwareUsed],
    creationDate: new Date(creationDate),
    status,
    featuredOrder,
  };

  if (projectId === null) {
    // Create path (defensive — the live create surface is
    // `app/admin/(protected)/projects/new/actions.ts`; this branch
    // exists only because `saveProject` is bound with a nullable
    // `projectId`). Cover media id is rejected here because no media
    // items exist yet — the editor gets a chance to upload them in a
    // subsequent save. Creation always starts in `draft`; `scheduled`
    // is forbidden on this path because there is no project row yet
    // for the publish-readiness gate to run against.
    if (status === 'scheduled') {
      return {
        status: 'error',
        message: 'New projects must start as draft.',
        errors: { status: 'New projects must start as draft.' },
      };
    }
    const row = await prisma.project.create({
      data: {
        ...data,
        status: status === 'published' ? 'published' : 'draft',
        coverMediaId: null,
        publishedAt: status === 'published' ? new Date() : null,
        scheduledAt: null,
      },
      select: { id: true, slug: true },
    });

    // Tag join rows.
    if (tagIds.length > 0) {
      await prisma.projectTag.createMany({
        data: tagIds.map((tagId) => ({ projectId: row.id, tagId })),
      });
    }

    revalidateProjectPaths(row.slug);
    redirect(`/admin/projects/${row.id}/edit?saved=1`);
  }

  // Update path.
  const current = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      status: true,
      publishedAt: true,
      coverMediaId: true,
      slug: true,
      mediaItems: {
        select: {
          id: true,
          kind: true,
          altText: true,
        },
      },
    },
  });
  if (current === null) {
    return {
      status: 'error',
      message: 'Project not found.',
      errors: {},
    };
  }

  // Publish-readiness gate. Required for any transition to either
  // `scheduled` or `published` (Requirement 8.1) — both states make the
  // project visible to the public surface (immediately for `published`,
  // at the cron tick for `scheduled`), so the same checklist guards
  // both paths. Failing codes come back in `RULE_ORDER` so the editor
  // can render them in stable order; the persisted state is left
  // unchanged on rejection because the early return happens before any
  // column write.
  if (status === 'published' || status === 'scheduled') {
    const ready = await reloadProjectAsDomain(projectId);
    if (ready !== null) {
      const next: Project = {
        ...ready,
        title: titleRaw,
      };
      const check = validatePublishable(next);
      if (!check.ok) {
        const ordered = RULE_ORDER.filter((code) => check.missing.includes(code));
        return {
          status: 'error',
          message: `Cannot ${status === 'published' ? 'publish' : 'schedule'}: ${ordered.join(', ')}.`,
          errors: {},
        };
      }
    }
  }

  // Canonical (status, scheduledAt, publishedAt) triple per
  // Requirements 7.5 / 7.6. The reducer is total over the three values
  // of `next.status`:
  //   - draft     → both timestamps null
  //   - published → scheduledAt cleared, publishedAt preserved when set
  //                 else stamped with `now`
  //   - scheduled → scheduledAt = parsed value, publishedAt unchanged
  // Computing the triple here keeps the persistence step a straight
  // write of three columns and means the rules live in exactly one
  // place (`lib/validation/schedule.ts`).
  const now = new Date();
  const transition = applyStatusTransition(
    {
      status: current.status as ProjectStatus,
      scheduledAt: null,
      publishedAt: current.publishedAt ?? null,
    },
    status === 'scheduled'
      ? { status: 'scheduled', scheduledAt: parsedScheduledAt as Date }
      : { status },
    now,
  );

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        ...data,
        status: transition.status,
        scheduledAt: transition.scheduledAt,
        publishedAt: transition.publishedAt,
      },
    });
    await tx.projectTag.deleteMany({ where: { projectId } });
    if (tagIds.length > 0) {
      await tx.projectTag.createMany({
        data: tagIds.map((tagId) => ({ projectId, tagId })),
      });
    }
  });

  // Slug-rename revalidation (Requirement 14.4).
  //
  // When the slug has changed the public surface carries TWO project
  // URLs that need flushing: the previous `/projects/{oldSlug}` (so it
  // stops returning the stale page or starts returning 404) and the
  // new `/projects/{newSlug}` (so the renamed project is reachable on
  // the next public request). Both helper invocations are required —
  // dropping either one strands one of the two URLs in the ISR cache.
  //
  // When the slug is unchanged we revalidate once. The comparison is
  // extracted into a named boolean so the branches read as a single
  // intent rather than two independent calls.
  const oldSlug = current.slug;
  const newSlug = slugCandidate;
  const slugChanged = oldSlug !== newSlug;
  if (slugChanged) {
    // Old slug first so the cached old URL is invalidated before the
    // new slug becomes the canonical route on the gallery / home
    // featured grids.
    revalidateProjectPaths(oldSlug);
    revalidateProjectPaths(newSlug);
  } else {
    revalidateProjectPaths(newSlug);
  }

  return {
    status: 'success',
    message: 'Project saved.',
    errors: {},
  };
}

// ---------------------------------------------------------------------------
// Media uploads
// ---------------------------------------------------------------------------

export interface UploadMediaState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message: string | null;
  readonly uploaded: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<string>;
}

export const INITIAL_UPLOAD_STATE: UploadMediaState = {
  status: 'idle',
  message: null,
  uploaded: [],
  skipped: [],
};

export async function uploadMedia(
  projectId: string,
  _prev: UploadMediaState,
  formData: FormData,
): Promise<UploadMediaState> {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, slug: true },
  });
  if (project === null) {
    return {
      status: 'error',
      message: 'Project not found.',
      uploaded: [],
      skipped: [],
    };
  }

  const files = formData.getAll('files').filter((v): v is File => v instanceof File);
  if (files.length === 0) {
    return {
      status: 'error',
      message: 'Pick one or more files first.',
      uploaded: [],
      skipped: [],
    };
  }

  const last = await prisma.mediaItem.findFirst({
    where: { projectId },
    orderBy: { ordering: 'desc' },
    select: { ordering: true },
  });
  let nextOrder = (last?.ordering ?? -1) + 1;

  const uploaded: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (file.size === 0) {
      continue;
    }
    const result = await storeProjectMedia(projectId, file);
    if (!result.ok) {
      skipped.push(result.error);
      continue;
    }
    const v = result.value;
    await prisma.mediaItem.create({
      data: {
        projectId,
        storageKey: v.storageKey,
        contentHash: v.contentHash,
        mimeType: v.mimeType,
        width: v.width,
        height: v.height,
        durationSec: null,
        byteSize: v.byteSize,
        kind: v.kind,
        altText: null,
        caption: null,
        ordering: nextOrder,
      },
    });
    nextOrder += 1;
    uploaded.push(file.name);
  }

  revalidateProjectPaths(project.slug);

  if (uploaded.length === 0 && skipped.length > 0) {
    return {
      status: 'error',
      message: skipped.join(' '),
      uploaded: [],
      skipped,
    };
  }
  return {
    status: uploaded.length > 0 ? 'success' : 'idle',
    message:
      skipped.length === 0
        ? `Uploaded ${uploaded.length} file${uploaded.length === 1 ? '' : 's'}.`
        : `Uploaded ${uploaded.length}; skipped ${skipped.length}: ${skipped.join(' ')}`,
    uploaded,
    skipped,
  };
}

// ---------------------------------------------------------------------------
// Media metadata edit (alt + caption + reorder)
// ---------------------------------------------------------------------------

export async function updateMediaItem(formData: FormData): Promise<void> {
  'use server';
  await requireAdmin();

  const id = (formData.get('id') ?? '').toString();
  if (id.length === 0) return;

  const altText = normalizeAltText((formData.get('altText') ?? '').toString());
  const caption = normalizeCaption((formData.get('caption') ?? '').toString());

  const item = await prisma.mediaItem.findUnique({
    where: { id },
    select: { projectId: true, project: { select: { slug: true } } },
  });
  if (item === null) return;

  await prisma.mediaItem.update({
    where: { id },
    data: {
      altText,
      caption,
    },
  });

  revalidateProjectPaths(item.project.slug);
}

export async function deleteMediaItem(formData: FormData): Promise<void> {
  'use server';
  await requireAdmin();

  const id = (formData.get('id') ?? '').toString();
  if (id.length === 0) return;

  const item = await prisma.mediaItem.findUnique({
    where: { id },
    select: { projectId: true, project: { select: { slug: true } } },
  });
  if (item === null) return;

  // Remove the row and the per-rendition R2 objects in the same
  // transaction so a Media_Item never lingers in the database with its
  // variants gone, or vice versa (Requirement 6.8). `deleteVariantKeys`
  // is best-effort at the per-key level — individual SDK failures are
  // swallowed inside the helper so the row delete still commits — but
  // any unexpected throw propagates and the transaction rolls back,
  // surfacing an actionable error to the admin instead of silently
  // stranding either side.
  await prisma.$transaction(async (tx) => {
    await tx.mediaItem.delete({ where: { id } });
    await deleteVariantKeys(id, { remove: async (key) => { await removeFromR2(key); } });
  });
  revalidateProjectPaths(item.project.slug);
}

/**
 * Result envelope for {@link setCoverMedia}. The action is the source
 * of truth for cover-selection validation: it refuses missing items
 * with `cover_media_not_found`, foreign items with
 * `cover_not_in_project`, and non-image items with `cover_must_be_image`
 * (Requirements 5.1, 5.2, 5.3). On every rejection branch
 * `Project.coverMediaId` is left exactly as it was — no column write
 * occurs on the rejection path (design.md "Cover selection lifecycle").
 */
export type SetCoverMediaResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: CoverErrorCode };

/**
 * Set the cover media for a project. The selected media item must
 * belong to the project and be an image. Used by the per-item
 * "Set as cover" button on the editor and by the auto-set path in
 * `finalizeUpload` (which routes through {@link applyCoverSelection}
 * directly so it can join the same transaction as the row insert).
 *
 * Validation is delegated to {@link applyCoverSelection} so the same
 * invariants (no write on rejection, identical rejection codes) hold
 * for both the user-facing and the server-internal call sites.
 */
export async function setCoverMedia(
  projectId: string,
  mediaId: string,
): Promise<SetCoverMediaResult> {
  await requireAdmin();

  if (projectId.length === 0 || mediaId.length === 0) {
    return { ok: false, code: 'cover_media_not_found' };
  }

  const result = await prisma.$transaction((tx) =>
    applyCoverSelection(tx, projectId, mediaId),
  );

  if (!result.ok) {
    return { ok: false, code: result.code };
  }

  revalidateProjectPaths(result.slug);
  return { ok: true };
}

/**
 * One-click publish from the editor's publish-readiness callout. Runs the
 * same `validatePublishable` gate as the regular save action and stamps
 * `publishedAt` if not already set.
 */
export async function publishProject(formData: FormData): Promise<void> {
  'use server';
  await requireAdmin();

  const projectId = (formData.get('projectId') ?? '').toString();
  if (projectId.length === 0) return;

  const project = await reloadProjectAsDomain(projectId);
  if (project === null) return;

  const check = validatePublishable(project);
  if (!check.ok) {
    return;
  }

  const current = await prisma.project.findUnique({
    where: { id: projectId },
    select: { slug: true, publishedAt: true },
  });
  if (current === null) return;

  await prisma.project.update({
    where: { id: projectId },
    data: {
      status: 'published',
      publishedAt: current.publishedAt ?? new Date(),
    },
  });

  revalidateProjectPaths(current.slug);
}

// ---------------------------------------------------------------------------
// Delete project
// ---------------------------------------------------------------------------

export async function deleteProject(formData: FormData): Promise<void> {
  'use server';
  await requireAdmin();

  const id = (formData.get('id') ?? '').toString();
  if (id.length === 0) return;

  const project = await prisma.project.findUnique({
    where: { id },
    select: { slug: true },
  });
  if (project === null) {
    redirect('/admin/projects');
  }

  await prisma.project.delete({ where: { id } });
  revalidateProjectPaths(project?.slug ?? null);
  redirect('/admin/projects');
}
