import { describe, expect, it } from 'vitest';
import { getAdjacentProjects } from '@/lib/projects/navigation';
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  Project,
  ProjectId,
  Slug,
} from '@/lib/types/domain';

/**
 * Build a minimal `Project` fixture with sensible defaults so each test only
 * has to override the fields it cares about (id, status, publishedAt).
 */
function makeProject(overrides: {
  id: string;
  status?: 'draft' | 'published';
  publishedAt: string | null;
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
    publishedAt:
      overrides.publishedAt === null ? null : (overrides.publishedAt as IsoTimestamp),
    scheduledAt: null,
    status: overrides.status ?? 'published',
    featuredOrder: null,
    createdAt: '2024-01-01T00:00:00.000Z' as IsoTimestamp,
    updatedAt: '2024-01-01T00:00:00.000Z' as IsoTimestamp,
  };
}

describe('getAdjacentProjects', () => {
  it('returns the previous (more recent) and next (older) projects in the middle of the list', () => {
    // publishedAt desc order: newest -> middle -> oldest
    const newest = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const middle = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });
    const oldest = makeProject({ id: 'c', publishedAt: '2024-01-01T00:00:00.000Z' });

    const result = getAdjacentProjects([oldest, newest, middle], 'b' as ProjectId);

    expect(result.previous?.id).toBe('a');
    expect(result.next?.id).toBe('c');
  });

  it('returns previous=null for the most recently published project', () => {
    const newest = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const older = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });

    const result = getAdjacentProjects([newest, older], 'a' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next?.id).toBe('b');
  });

  it('returns next=null for the oldest published project', () => {
    const newest = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const oldest = makeProject({ id: 'b', publishedAt: '2024-01-01T00:00:00.000Z' });

    const result = getAdjacentProjects([newest, oldest], 'b' as ProjectId);

    expect(result.previous?.id).toBe('a');
    expect(result.next).toBeNull();
  });

  it('returns both null for a single published project', () => {
    const only = makeProject({ id: 'solo', publishedAt: '2024-03-01T00:00:00.000Z' });

    const result = getAdjacentProjects([only], 'solo' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next).toBeNull();
  });

  it('returns both null when currentId is unknown', () => {
    const a = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const b = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });

    const result = getAdjacentProjects([a, b], 'missing' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next).toBeNull();
  });

  it('returns both null when the catalogue is empty', () => {
    const result = getAdjacentProjects([], 'anything' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next).toBeNull();
  });

  it('excludes drafts so neighbours are computed across published projects only', () => {
    const newest = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const draft = makeProject({
      id: 'd',
      status: 'draft',
      publishedAt: null,
    });
    const oldest = makeProject({ id: 'c', publishedAt: '2024-01-01T00:00:00.000Z' });

    // Even with a draft sitting between them by some other ordering, the
    // adjacency for the published list goes a -> c.
    const result = getAdjacentProjects([newest, draft, oldest], 'a' as ProjectId);

    expect(result.previous).toBeNull();
    expect(result.next?.id).toBe('c');
  });

  it('returns both null when currentId points to a draft', () => {
    const newest = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const draft = makeProject({
      id: 'd',
      status: 'draft',
      publishedAt: null,
    });

    const result = getAdjacentProjects([newest, draft], 'd' as ProjectId);

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

    // Pass them in shuffled order to make sure the function does the sort.
    const result = getAdjacentProjects([e, c, d], 'd' as ProjectId);

    expect(result.previous?.id).toBe('c');
    expect(result.next?.id).toBe('e');
  });

  it('does not mutate the input array', () => {
    const a = makeProject({ id: 'a', publishedAt: '2024-03-01T00:00:00.000Z' });
    const b = makeProject({ id: 'b', publishedAt: '2024-02-01T00:00:00.000Z' });
    const input = [b, a];
    const snapshot = [...input];

    getAdjacentProjects(input, 'a' as ProjectId);

    expect(input).toEqual(snapshot);
  });
});
