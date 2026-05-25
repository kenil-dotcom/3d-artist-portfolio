/**
 * Integration test for Task 10.2 — auto-clear cover when the cover
 * Media_Item is deleted (Requirement 5.5).
 *
 * Exercises the full round trip across two server actions:
 *
 *   1. `setCoverMedia(projectId, mediaId)` selects an image-kind
 *      Media_Item as the project's cover.
 *   2. `deleteMediaItem({ id })` removes that Media_Item.
 *
 * The schema-level `onDelete: SetNull` on `Project.coverMediaId`
 * (prisma/schema.prisma) is the canonical mechanism that flips the
 * cover reference back to `null` when the referenced Media_Item is
 * deleted. The test simulates that database-level behaviour inside the
 * fake Prisma adapter so the cooperation between `setCoverMedia` and
 * `deleteMediaItem` is exercised end-to-end at the application layer.
 *
 * The "gallery thumbnail disappears after the same-request
 * `revalidatePath`" half of the assertion is verified by:
 *
 *   - confirming `revalidatePath('/projects/{slug}')` and
 *     `revalidatePath('/gallery')` were invoked inside the same
 *     `deleteMediaItem` call (so any subsequent public read returns the
 *     cleared cover); and
 *   - re-running the same `findCover` logic the public gallery page
 *     uses (`app/gallery/page.tsx::findCover`) against the post-delete
 *     project snapshot and asserting it now returns `null` — i.e., the
 *     tile's `<ResponsiveImage>` is replaced by the gradient
 *     placeholder.
 *
 * Mocks are scoped to this file:
 *   - `@/lib/db/prisma`            — recording fake adapter.
 *   - `next/cache.revalidatePath`  — captures revalidated paths.
 *   - `@/lib/auth/middleware`      — bypasses session lookup.
 *   - `@/lib/admin/uploads`        — stubs R2 deletes.
 *   - `@/lib/admin/variants`       — stubs the variant cleanup helper.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  IsoDate,
  IsoTimestamp,
  MediaItem,
  MediaItemId,
  Project,
  ProjectId,
  Slug,
} from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Hoisted shared state for module mocks
// ---------------------------------------------------------------------------

interface FakeProjectRow {
  readonly id: string;
  readonly slug: string;
  coverMediaId: string | null;
}

interface FakeMediaRow {
  readonly id: string;
  readonly projectId: string;
  readonly kind: 'image' | 'video' | 'model3d';
}

const state = vi.hoisted(() => ({
  projects: [] as FakeProjectRow[],
  media: [] as FakeMediaRow[],
  revalidated: [] as string[],
  projectUpdates: [] as Array<{
    where: { id: string };
    data: Record<string, unknown>;
  }>,
}));

// ---------------------------------------------------------------------------
// Fake Prisma adapter
//
// One shared shape is used for both the top-level `prisma` client and
// the `tx` argument inside `prisma.$transaction(callback)` so the
// behaviour is identical regardless of which entry point invoked it.
// The `mediaItem.delete` handler simulates the schema-level
// `onDelete: SetNull` on `Project.coverMediaId` by walking every
// project row and clearing references to the deleted id (mirroring the
// SQL `ON DELETE SET NULL` in `prisma/schema.prisma`).
// ---------------------------------------------------------------------------

vi.mock('@/lib/db/prisma', () => {
  // The adapter shape is built lazily inside the factory so
  // `vi.hoisted`'s `state` is captured by reference.

  type SelectArg = Record<string, unknown> | undefined;

  function getSelect(args: { select?: SelectArg } | undefined): SelectArg {
    return args?.select;
  }

  const adapter = {
    project: {
      findUnique: vi.fn(
        async (args: { where: { id?: string; slug?: string }; select?: SelectArg }) => {
          const row =
            args.where.id !== undefined
              ? state.projects.find((p) => p.id === args.where.id)
              : state.projects.find((p) => p.slug === args.where.slug);
          if (row === undefined) return null;
          const select = getSelect(args);
          // Narrow projections used by the actions under test.
          if (select && (select['coverMediaId'] || select['slug'])) {
            return {
              coverMediaId: row.coverMediaId,
              slug: row.slug,
            };
          }
          // `select: { id: true }` shape used by the slug-uniqueness
          // path in saveProject — irrelevant here but kept for safety.
          return { id: row.id, slug: row.slug, coverMediaId: row.coverMediaId };
        },
      ),
      update: vi.fn(
        async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          state.projectUpdates.push({ where: args.where, data: args.data });
          const row = state.projects.find((p) => p.id === args.where.id);
          if (row !== undefined && 'coverMediaId' in args.data) {
            row.coverMediaId =
              (args.data['coverMediaId'] as string | null | undefined) ?? null;
          }
          return row;
        },
      ),
    },
    mediaItem: {
      findUnique: vi.fn(
        async (args: { where: { id: string }; select?: SelectArg }) => {
          const row = state.media.find((m) => m.id === args.where.id);
          if (row === undefined) return null;
          const select = getSelect(args);
          // `applyCoverSelection` uses `select: { projectId: true, kind: true }`.
          if (select && select['projectId'] && select['kind']) {
            return { projectId: row.projectId, kind: row.kind };
          }
          // `deleteMediaItem` uses
          //   `select: { projectId: true, project: { select: { slug: true } } }`.
          if (select && select['project']) {
            const proj = state.projects.find((p) => p.id === row.projectId);
            return {
              projectId: row.projectId,
              project: { slug: proj?.slug ?? '' },
            };
          }
          return row;
        },
      ),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const idx = state.media.findIndex((m) => m.id === args.where.id);
        if (idx < 0) throw new Error('media not found');
        const removed = state.media[idx]!;
        state.media.splice(idx, 1);
        // Simulate schema-level `onDelete: SetNull` on
        // `Project.coverMediaId`. Mirrors the SQL the database engine
        // would run after the row is deleted.
        for (const p of state.projects) {
          if (p.coverMediaId === removed.id) {
            p.coverMediaId = null;
          }
        }
        return removed;
      }),
    },
    $transaction: vi.fn(
      async (fnOrArr: unknown): Promise<unknown> => {
        if (typeof fnOrArr === 'function') {
          return (fnOrArr as (tx: typeof adapter) => Promise<unknown>)(adapter);
        }
        return Promise.all(fnOrArr as ReadonlyArray<Promise<unknown>>);
      },
    ),
  };

  return { prisma: adapter };
});

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn((path: string) => {
    state.revalidated.push(path);
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect: ${url}`);
  }),
  notFound: vi.fn(() => {
    throw new Error('notFound');
  }),
}));

vi.mock('@/lib/auth/middleware', () => ({
  requireAdmin: vi.fn(async () => ({
    admin: { id: 'admin-1', username: 'admin' },
  })),
}));

vi.mock('@/lib/admin/uploads', () => ({
  removeFromR2: vi.fn(async () => true),
  storeProjectMedia: vi.fn(),
}));

vi.mock('@/lib/admin/variants', () => ({
  deleteVariantKeys: vi.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Imports under test (must come AFTER the `vi.mock` calls above)
// ---------------------------------------------------------------------------

import {
  deleteMediaItem,
  setCoverMedia,
} from '@/app/admin/(protected)/projects/[id]/edit/actions';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const NOW = '2025-06-15T12:00:00.000Z';

function makeMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'media-1' as MediaItemId,
    projectId: 'project-1' as ProjectId,
    ref: {
      storageKey: 'https://cdn.test/media/2025/cover.jpg',
      contentHash: 'abc' as never,
      mimeType: 'image/jpeg',
      width: 1920,
      height: 1080,
      durationSec: null,
      byteSize: 1234,
    },
    kind: 'image',
    altText: 'A descriptive alt text.',
    caption: null,
    ordering: 0,
    captionsRef: null,
    transcript: null,
    embedUrl: null,
    extension: 'jpg',
    variantSet: { renditions: [], failures: [] },
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  const cover = makeMediaItem();
  return {
    id: 'project-1' as ProjectId,
    slug: 'project-one' as Slug,
    title: 'Project One',
    description: '',
    categoryId: 'renders' as never,
    tagIds: [],
    coverMediaId: cover.id,
    mediaItems: [cover],
    softwareUsed: [],
    creationDate: '2025-01-10' as IsoDate,
    publishedAt: null,
    scheduledAt: null,
    status: 'published',
    featuredOrder: null,
    createdAt: NOW as IsoTimestamp,
    updatedAt: NOW as IsoTimestamp,
    ...overrides,
  };
}

/**
 * Re-implementation of `findCover` from `app/gallery/page.tsx`. The
 * gallery page does not export this helper, so we mirror its logic
 * here to assert the post-delete project snapshot no longer surfaces a
 * thumbnail.
 *
 * Returns the resolved cover URL or `null` when the gallery tile
 * should fall back to the gradient placeholder.
 */
function findCoverUrl(project: Project): string | null {
  const all = project.mediaItems;
  let item =
    project.coverMediaId === null
      ? null
      : all.find(
          (m) => (m.id as unknown as string) === (project.coverMediaId as unknown as string),
        ) ?? null;
  if (item === null) {
    item = all.find((m) => m.kind === 'image') ?? null;
  }
  return item === null ? null : item.ref.storageKey;
}

/** Snapshot the public-facing project view after a mutation round trip. */
function snapshotProject(): Project {
  const row = state.projects[0]!;
  const items: ReadonlyArray<MediaItem> = state.media
    .filter((m) => m.projectId === row.id)
    .map((m) =>
      makeMediaItem({
        id: m.id as MediaItemId,
        projectId: m.projectId as ProjectId,
        kind: m.kind,
      }),
    );
  return makeProject({
    id: row.id as ProjectId,
    slug: row.slug as Slug,
    coverMediaId:
      row.coverMediaId === null ? null : (row.coverMediaId as MediaItemId),
    mediaItems: items,
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  state.projects.length = 0;
  state.media.length = 0;
  state.revalidated.length = 0;
  state.projectUpdates.length = 0;

  state.projects.push({
    id: 'project-1',
    slug: 'project-one',
    coverMediaId: null,
  });
  state.media.push({ id: 'media-1', projectId: 'project-1', kind: 'image' });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cover auto-clear when the cover Media_Item is deleted (Requirement 5.5)', () => {
  it('round trip: setCoverMedia → deleteMediaItem flips Project.coverMediaId to null', async () => {
    // 1. Set the image as cover.
    const setResult = await setCoverMedia('project-1', 'media-1');
    expect(setResult).toEqual({ ok: true });
    expect(state.projects[0]!.coverMediaId).toBe('media-1');

    // 2. Delete the cover Media_Item.
    const fd = new FormData();
    fd.set('id', 'media-1');
    await deleteMediaItem(fd);

    // 3. The schema-level `onDelete: SetNull` flipped coverMediaId back
    //    to null inside the same delete transaction. The Media_Item row
    //    itself is gone.
    expect(state.projects[0]!.coverMediaId).toBeNull();
    expect(state.media.find((m) => m.id === 'media-1')).toBeUndefined();
  });

  it('revalidates the public project and gallery surfaces in the same request, so the gallery thumbnail disappears', async () => {
    // Pre-condition: project has an image cover.
    await setCoverMedia('project-1', 'media-1');
    state.revalidated.length = 0; // ignore the set-cover revalidations

    // Sanity check: while the cover is set, `findCover` resolves to the
    // image's storage key, i.e., the gallery tile would render the
    // image thumbnail.
    expect(findCoverUrl(snapshotProject())).toBe(
      'https://cdn.test/media/2025/cover.jpg',
    );

    // Delete the cover.
    const fd = new FormData();
    fd.set('id', 'media-1');
    await deleteMediaItem(fd);

    // The gallery + project public paths are both revalidated within
    // the same `deleteMediaItem` invocation (Requirement 14.1–14.3).
    expect(state.revalidated).toContain('/gallery');
    expect(state.revalidated).toContain('/projects/project-one');
    expect(state.revalidated).toContain('/');

    // After revalidation, the gallery's `findCover` logic returns null
    // because (a) coverMediaId is null and (b) no image-kind Media_Item
    // remains on the project — so the tile falls back to the gradient
    // placeholder rather than rendering a stale `<ResponsiveImage>`.
    expect(findCoverUrl(snapshotProject())).toBeNull();
  });

  it('does not write to Project.coverMediaId from deleteMediaItem itself; the SetNull is a database-side effect', async () => {
    // setCoverMedia is the only path that should call project.update
    // for coverMediaId; deleteMediaItem relies on the schema-level
    // SetNull and never issues a project.update of its own.
    await setCoverMedia('project-1', 'media-1');
    const updatesAfterSet = state.projectUpdates.length;

    const fd = new FormData();
    fd.set('id', 'media-1');
    await deleteMediaItem(fd);

    expect(state.projectUpdates).toHaveLength(updatesAfterSet);
    expect(state.projects[0]!.coverMediaId).toBeNull();
  });
});
