/**
 * Unit tests for `listGallery` (Task 3.1 / Requirement 2 + 8.7).
 *
 * These cover the example-level guarantees: filtering by category and tags
 * (set semantics), sort orders with deterministic tie-breakers, page
 * clamping, and empty-result handling.
 *
 * The sibling property-based test (Task 3.2 / Property 3) is optional and
 * lives under `tests/pbt/`.
 */

import { describe, expect, it } from 'vitest';
import { GALLERY_PAGE_SIZE, listGallery } from '@/lib/gallery/listing';
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  Project,
  ProjectId,
  ProjectStatus,
  Slug,
  TagId,
} from '@/lib/types/domain';
import type { GalleryQuery, GallerySort } from '@/lib/types/cms';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const NOW = '2025-06-15T12:00:00.000Z';

function project(input: {
  id: string;
  title: string;
  status?: ProjectStatus;
  categoryId?: string;
  tagIds?: ReadonlyArray<string>;
  publishedAt?: string | null;
}): Project {
  const status = input.status ?? 'published';
  return {
    id: input.id as ProjectId,
    slug: input.id as Slug,
    title: input.title,
    description: '',
    categoryId: (input.categoryId ?? 'renders') as CategoryId,
    tagIds: (input.tagIds ?? []) as ReadonlyArray<TagId>,
    coverMediaId: null,
    mediaItems: [],
    softwareUsed: [],
    creationDate: '2024-01-01' as IsoDate,
    publishedAt:
      status === 'published'
        ? ((input.publishedAt ?? NOW) as IsoTimestamp)
        : null,
    status,
    featuredOrder: null,
    createdAt: NOW as IsoTimestamp,
    updatedAt: NOW as IsoTimestamp,
  };
}

function makeQuery(overrides: Partial<GalleryQuery> = {}): GalleryQuery {
  return {
    page: 1,
    category: null,
    tags: [],
    sort: 'newest',
    ...overrides,
  };
}

function ids(items: ReadonlyArray<Project>): string[] {
  return items.map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

describe('listGallery: filtering', () => {
  it('excludes draft projects (Requirement 8.7)', () => {
    const projects = [
      project({ id: 'a', title: 'A', status: 'draft' }),
      project({ id: 'b', title: 'B' }),
    ];

    const result = listGallery(projects, makeQuery());

    expect(ids(result.items)).toEqual(['b']);
    expect(result.totalCount).toBe(1);
  });

  it('keeps only projects matching the requested category', () => {
    const projects = [
      project({ id: 'a', title: 'A', categoryId: 'renders' }),
      project({ id: 'b', title: 'B', categoryId: 'models' }),
      project({ id: 'c', title: 'C', categoryId: 'renders' }),
    ];

    const result = listGallery(
      projects,
      makeQuery({ category: 'renders' as CategoryId }),
    );

    expect(ids(result.items).sort()).toEqual(['a', 'c']);
  });

  it('requires every selected tag to be present (conjunctive ALL)', () => {
    const projects = [
      project({ id: 'a', title: 'A', tagIds: ['x', 'y'] }),
      project({ id: 'b', title: 'B', tagIds: ['x'] }),
      project({ id: 'c', title: 'C', tagIds: ['x', 'y', 'z'] }),
    ];

    const result = listGallery(
      projects,
      makeQuery({ tags: ['x' as TagId, 'y' as TagId] }),
    );

    expect(ids(result.items).sort()).toEqual(['a', 'c']);
  });

  it('is invariant under reordering of query.tags (set semantics)', () => {
    const projects = [
      project({ id: 'a', title: 'A', tagIds: ['x', 'y', 'z'] }),
      project({ id: 'b', title: 'B', tagIds: ['x', 'y'] }),
    ];

    const r1 = listGallery(
      projects,
      makeQuery({ tags: ['x', 'y'] as ReadonlyArray<TagId> }),
    );
    const r2 = listGallery(
      projects,
      makeQuery({ tags: ['y', 'x'] as ReadonlyArray<TagId> }),
    );

    expect(ids(r1.items)).toEqual(ids(r2.items));
  });

  it('returns an empty page when no projects match the filters', () => {
    const projects = [project({ id: 'a', title: 'A', categoryId: 'renders' })];

    const result = listGallery(
      projects,
      makeQuery({ category: 'animations' as CategoryId }),
    );

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
    expect(result.outOfRange).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

describe('listGallery: sort orders', () => {
  const projects = [
    project({ id: 'a', title: 'Charlie', publishedAt: '2025-01-01T00:00:00.000Z' }),
    project({ id: 'b', title: 'alpha',   publishedAt: '2025-03-01T00:00:00.000Z' }),
    project({ id: 'c', title: 'Bravo',   publishedAt: '2025-02-01T00:00:00.000Z' }),
  ];

  it('newest sorts by publishedAt descending', () => {
    const result = listGallery(projects, makeQuery({ sort: 'newest' }));
    expect(ids(result.items)).toEqual(['b', 'c', 'a']);
  });

  it('oldest sorts by publishedAt ascending', () => {
    const result = listGallery(projects, makeQuery({ sort: 'oldest' }));
    expect(ids(result.items)).toEqual(['a', 'c', 'b']);
  });

  it('title_asc is case-insensitive', () => {
    const result = listGallery(projects, makeQuery({ sort: 'title_asc' }));
    // alpha < Bravo < Charlie under case-insensitive compare
    expect(ids(result.items)).toEqual(['b', 'c', 'a']);
  });

  it('newest tie-breaks by id ascending when publishedAt collides', () => {
    const ts = '2025-04-01T00:00:00.000Z';
    const tied = [
      project({ id: 'b', title: 'B', publishedAt: ts }),
      project({ id: 'a', title: 'A', publishedAt: ts }),
      project({ id: 'c', title: 'C', publishedAt: ts }),
    ];

    const result = listGallery(tied, makeQuery({ sort: 'newest' }));
    expect(ids(result.items)).toEqual(['a', 'b', 'c']);
  });

  it('title_asc tie-breaks by publishedAt desc then id asc', () => {
    const tied = [
      project({ id: 'a', title: 'Same', publishedAt: '2025-01-01T00:00:00.000Z' }),
      project({ id: 'b', title: 'same', publishedAt: '2025-03-01T00:00:00.000Z' }),
      project({ id: 'c', title: 'SAME', publishedAt: '2025-02-01T00:00:00.000Z' }),
    ];

    const result = listGallery(tied, makeQuery({ sort: 'title_asc' }));
    expect(ids(result.items)).toEqual(['b', 'c', 'a']);
  });

  it('produces a stable order across all sort modes for fixed input', () => {
    const sorts: GallerySort[] = ['newest', 'oldest', 'title_asc'];
    for (const sort of sorts) {
      const r1 = listGallery(projects, makeQuery({ sort }));
      const r2 = listGallery(projects, makeQuery({ sort }));
      expect(ids(r1.items)).toEqual(ids(r2.items));
    }
  });
});

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

describe('listGallery: pagination', () => {
  function buildPublishedRange(count: number): Project[] {
    return Array.from({ length: count }, (_, i) => {
      // Newest first when sorted by publishedAt desc: stagger timestamps so
      // i=0 is oldest, i=count-1 is newest.
      const minute = String(i).padStart(2, '0');
      return project({
        id: `p${String(i).padStart(3, '0')}`,
        title: `Project ${i}`,
        publishedAt: `2025-01-01T00:${minute}:00.000Z`,
      });
    });
  }

  it('caps each page at 24 items', () => {
    const projects = buildPublishedRange(50);
    const result = listGallery(projects, makeQuery({ page: 1 }));

    expect(result.items.length).toBe(GALLERY_PAGE_SIZE);
    expect(result.totalCount).toBe(50);
    expect(result.totalPages).toBe(3);
  });

  it('returns the trailing partial page', () => {
    const projects = buildPublishedRange(50);
    const result = listGallery(projects, makeQuery({ page: 3 }));

    expect(result.items.length).toBe(50 - 2 * GALLERY_PAGE_SIZE);
    expect(result.page).toBe(3);
    expect(result.outOfRange).toBe(false);
  });

  it('clamps page numbers above totalPages and flags outOfRange', () => {
    const projects = buildPublishedRange(30);
    const result = listGallery(projects, makeQuery({ page: 99 }));

    expect(result.totalPages).toBe(2);
    expect(result.page).toBe(1);
    expect(result.outOfRange).toBe(true);
    // First page contents preserved.
    expect(result.items.length).toBe(GALLERY_PAGE_SIZE);
  });

  it('clamps page numbers below 1 and flags outOfRange', () => {
    const projects = buildPublishedRange(5);
    const result = listGallery(projects, makeQuery({ page: 0 }));

    expect(result.page).toBe(1);
    expect(result.outOfRange).toBe(true);
    expect(result.totalPages).toBe(1);
    expect(result.items.length).toBe(5);
  });

  it('uses totalPages = 1 even when there are zero matching projects', () => {
    const result = listGallery([], makeQuery());

    expect(result.items).toEqual([]);
    expect(result.totalCount).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.page).toBe(1);
    expect(result.outOfRange).toBe(false);
  });

  it('does not mutate the caller-provided projects array', () => {
    const projects = buildPublishedRange(10);
    const before = ids(projects);

    listGallery(projects, makeQuery({ sort: 'oldest' }));

    expect(ids(projects)).toEqual(before);
  });
});
