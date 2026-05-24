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
import { storeProjectMedia } from '@/lib/admin/uploads';
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
  TITLE_MAX_LENGTH,
} from '@/lib/validation/project';

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
    status: row.status as ProjectStatus,
    featuredOrder: row.featuredOrder,
    createdAt: brand(row.createdAt.toISOString()),
    updatedAt: brand(row.updatedAt.toISOString()),
  };
}

function revalidateProjectPaths(slug: string | null): void {
  revalidatePath('/admin/projects');
  revalidatePath('/admin');
  revalidatePath('/');
  revalidatePath('/gallery');
  if (slug !== null && slug.length > 0) {
    revalidatePath(`/projects/${slug}`);
  }
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
  const softwareUsed = parseStringList(formData, 'softwareUsed');
  const creationDate = (formData.get('creationDate') ?? '').toString();
  const statusRaw = (formData.get('status') ?? 'draft').toString();
  const status: ProjectStatus =
    statusRaw === 'published' ? 'published' : 'draft';
  const coverMediaIdRaw = (formData.get('coverMediaId') ?? '').toString();
  const coverMediaId = coverMediaIdRaw.length > 0 ? coverMediaIdRaw : null;
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
    coverMediaId,
  };

  if (projectId === null) {
    // Create path. Cover media id is rejected here because no media
    // items exist yet — the editor gets a chance to upload them in a
    // subsequent save.
    const row = await prisma.project.create({
      data: {
        ...data,
        coverMediaId: null,
        publishedAt: status === 'published' ? new Date() : null,
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

  // Publish-readiness gate. Only enforced when transitioning to published.
  if (status === 'published') {
    const ready = await reloadProjectAsDomain(projectId);
    if (ready !== null) {
      const next: Project = {
        ...ready,
        title: titleRaw,
        coverMediaId:
          coverMediaId === null ? null : brand<MediaItemId>(coverMediaId),
      };
      const check = validatePublishable(next);
      if (!check.ok) {
        return {
          status: 'error',
          message: `Cannot publish: ${check.missing.join(', ')}.`,
          errors: {},
        };
      }
    }
  }

  // Compute publishedAt: stamp on first transition to published, clear
  // when reverting to draft.
  let publishedAt: Date | null = current.publishedAt ?? null;
  if (status === 'published' && publishedAt === null) {
    publishedAt = new Date();
  } else if (status === 'draft') {
    publishedAt = null;
  }

  await prisma.$transaction(async (tx) => {
    await tx.project.update({
      where: { id: projectId },
      data: {
        ...data,
        publishedAt,
      },
    });
    await tx.projectTag.deleteMany({ where: { projectId } });
    if (tagIds.length > 0) {
      await tx.projectTag.createMany({
        data: tagIds.map((tagId) => ({ projectId, tagId })),
      });
    }
  });

  revalidateProjectPaths(current.slug);
  revalidateProjectPaths(slugCandidate);

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

  const altText = (formData.get('altText') ?? '').toString().trim();
  const caption = (formData.get('caption') ?? '').toString().trim();

  const item = await prisma.mediaItem.findUnique({
    where: { id },
    select: { projectId: true, project: { select: { slug: true } } },
  });
  if (item === null) return;

  await prisma.mediaItem.update({
    where: { id },
    data: {
      altText: altText.length === 0 ? null : altText.slice(0, 500),
      caption: caption.length === 0 ? null : caption.slice(0, 200),
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

  await prisma.mediaItem.delete({ where: { id } });
  revalidateProjectPaths(item.project.slug);
}

export async function moveMediaItem(formData: FormData): Promise<void> {
  'use server';
  await requireAdmin();

  const id = (formData.get('id') ?? '').toString();
  const direction = (formData.get('direction') ?? '').toString();
  if (id.length === 0 || (direction !== 'up' && direction !== 'down')) return;

  const item = await prisma.mediaItem.findUnique({
    where: { id },
    select: {
      id: true,
      ordering: true,
      projectId: true,
      project: { select: { slug: true } },
    },
  });
  if (item === null) return;

  const neighbour = await prisma.mediaItem.findFirst({
    where: {
      projectId: item.projectId,
      ordering:
        direction === 'up'
          ? { lt: item.ordering }
          : { gt: item.ordering },
    },
    orderBy: { ordering: direction === 'up' ? 'desc' : 'asc' },
    select: { id: true, ordering: true },
  });
  if (neighbour === null) return;

  // Swap ordering values. Use a temporary high value to avoid the
  // unlikely-but-possible collision that two-step swaps suffer from.
  const tmp = -1;
  await prisma.$transaction(async (tx) => {
    await tx.mediaItem.update({ where: { id: item.id }, data: { ordering: tmp } });
    await tx.mediaItem.update({
      where: { id: neighbour.id },
      data: { ordering: item.ordering },
    });
    await tx.mediaItem.update({
      where: { id: item.id },
      data: { ordering: neighbour.ordering },
    });
  });

  revalidateProjectPaths(item.project.slug);
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
