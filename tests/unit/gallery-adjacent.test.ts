import { describe, expect, it } from 'vitest';
import { findAdjacentProjects } from '@/lib/gallery/adjacent';
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  Project,
  ProjectId,
  Slug,
} from '@/lib/types/domain';

/**
 * Build a minimal published `Project` fixture so each test only has to
 * override the fields that matter (id, publishedAt). `findAdjacentProjects`
 * expects callers to have already filtered to publicly visible projects, so
 * the default fixture is `status: "published"` with a real `publishedAt`.
 */
function makeProject(overrides: {
  id: string;
  publishedAt: string;
  slug?: string;
}): Project {
  return {
    id: overrides.id as ProjectId,
    slug: (overrides.slug ?? overrides.id) as Slug,
    title: `Title ${overrides.id}`,
    description: '',
    categoryId: 'cat-1' as CategoryId,
    tagIds: [],
    coverMediaId: null,
    mediaItems: [],
    softwareUsed: [],
    creationDate: '2024-01-01' as IsoDate,
    publishedAt: overrides.publishedAt as IsoTimestamp,
    status: 'published',
    featuredOrder: null,
    createdAt: '2024-01-01T00:00:00.000Z' as IsoTimestamp,
    updatedAt: '2024-01-01T00:00:00.000Z' as IsoTimestamp,
  };
}

describe('findAdjacentProjects', () => {
  it('returns the previous (more recent) and next (older) projects in the middle of the list', () => {
    // publishedAt desc order: newest -> middle -> oldest
    const newest = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const middle = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });
    const oldest = makeProject({ id: 'c', publishedAt: '2024-01-01T00:00:00.000Z' });

    // Pass them in shuffled order to verify the function does the sort.
    const result = findAdjacentProjects([oldest, newest, middle], 'b' as ProjectId);

    expect(result.previous?.id).toBe('a');
    expect(result.next?.id).toBe('c');
  });

  it('returns previous=null for the most recently published project', () => {
    const newest = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const older = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });

    const result = findAdjacentProjects([newest, older], 'a' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next?.id).toBe('b');
  });

  it('returns next=null for the oldest published project', () => {
    const newest = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const oldest = makeProject({ id: 'b', publishedAt: '2024-01-01T00:00:00.000Z' });

    const result = findAdjacentProjects([newest, oldest], 'b' as ProjectId);

    expect(result.previous?.id).toBe('a');
    expect(result.next).toBeNull();
  });

  it('returns both null for a single published project', () => {
    const only = makeProject({ id: 'solo', publishedAt: '2024-03-01T00:00:00.000Z' });

    const result = findAdjacentProjects([only], 'solo' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next).toBeNull();
  });

  it('returns both null when currentId is unknown', () => {
    const a = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const b = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });

    const result = findAdjacentProjects([a, b], 'missing' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next).toBeNull();
  });

  it('returns both null when the catalogue is empty', () => {
    const result = findAdjacentProjects([], 'anything' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next).toBeNull();
  });

  it('breaks publishedAt ties deterministically by id ascending', () => {
    // Three projects share the same publishedAt; id ascending is c < d < e,
    // so prev/next of "d" must be "c" and "e" respectively.
    const sameTime = '2024-02-01T00:00:00.000Z';
    const c = makeProject({ id: 'c', publishedAt: sameTime });
    const d = makeProject({ id: 'd', publishedAt: sameTime });
    const e = makeProject({ id: 'e', publishedAt: sameTime });

    const result = findAdjacentProjects([e, c, d], 'd' as ProjectId);

    expect(result.previous?.id).toBe('c');
    expect(result.next?.id).toBe('e');
  });

  it('walks the full catalogue end-to-end with the expected disabled endpoints', () => {
    // Build a 5-project list covering Jan..May; expect prev/next to walk the
    // list in publishedAt-desc order: e (May) -> d -> c -> b -> a (Jan).
    const a = makeProject({ id: 'a', publishedAt: '2024-01-01T00:00:00.000Z' });
    const b = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });
    const c = makeProject({ id: 'c', publishedAt: '2024-03-01T00:00:00.000Z' });
    const d = makeProject({ id: 'd', publishedAt: '2024-04-01T00:00:00.000Z' });
    const e = makeProject({ id: 'e', publishedAt: '2024-05-01T00:00:00.000Z' });
    const list = [a, b, c, d, e];

    // Newest endpoint: no previous, next is one step older.
    const top = findAdjacentProjects(list, 'e' as ProjectId);
    expect(top.previous).toBeNull();
    expect(top.next?.id).toBe('d');

    // Middle: previous is newer, next is older.
    const mid = findAdjacentProjects(list, 'c' as ProjectId);
    expect(mid.previous?.id).toBe('d');
    expect(mid.next?.id).toBe('b');

    // Oldest endpoint: previous is one step newer, no next.
    const bottom = findAdjacentProjects(list, 'a' as ProjectId);
    expect(bottom.previous?.id).toBe('b');
    expect(bottom.next).toBeNull();
  });

  it('does not mutate the input array', () => {
    const a = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const b = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });
    const input = [b, a];
    const snapshot = [...input];

    findAdjacentProjects(input, 'a' as ProjectId);

    expect(input).toEqual(snapshot);
  });
});
