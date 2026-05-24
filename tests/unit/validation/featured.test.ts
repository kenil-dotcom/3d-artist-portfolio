import { describe, expect, it } from 'vitest';

import {
  FEATURED_MAX,
  validateFeaturedIds,
} from '@/lib/validation/featured';
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  Project,
  ProjectId,
  ProjectStatus,
  Slug,
} from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ID = (raw: string): ProjectId => raw as ProjectId;
const CATEGORY = 'cat-renders' as CategoryId;
const TIMESTAMP = '2024-01-01T00:00:00.000Z' as IsoTimestamp;
const DATE = '2024-01-01' as IsoDate;

function makeProject(id: string, status: ProjectStatus = 'published'): Project {
  return {
    id: ID(id),
    slug: id as Slug,
    title: `Project ${id}`,
    description: '',
    categoryId: CATEGORY,
    tagIds: [],
    coverMediaId: null,
    mediaItems: [],
    softwareUsed: [],
    creationDate: DATE,
    publishedAt: status === 'published' ? TIMESTAMP : null,
    status,
    featuredOrder: null,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateFeaturedIds', () => {
  it('accepts an empty list and returns no assignments', () => {
    const result = validateFeaturedIds([], []);
    expect(result).toEqual({ ok: true, assignments: [] });
  });

  it('assigns featuredOrder = index in the supplied order', () => {
    const projects = [
      makeProject('a'),
      makeProject('b'),
      makeProject('c'),
    ];
    const result = validateFeaturedIds([ID('c'), ID('a'), ID('b')], projects);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toEqual([
      { id: ID('c'), order: 0 },
      { id: ID('a'), order: 1 },
      { id: ID('b'), order: 2 },
    ]);
  });

  it('accepts the maximum-sized list (12 entries)', () => {
    const projects = Array.from({ length: FEATURED_MAX }, (_, i) =>
      makeProject(`p${i}`),
    );
    const ids = projects.map((p) => p.id);

    const result = validateFeaturedIds(ids, projects);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assignments).toHaveLength(FEATURED_MAX);
    expect(result.assignments.map((a) => a.order)).toEqual(
      Array.from({ length: FEATURED_MAX }, (_, i) => i),
    );
  });

  it('rejects lists longer than 12 with featured_too_many', () => {
    const projects = Array.from({ length: 13 }, (_, i) => makeProject(`p${i}`));
    const ids = projects.map((p) => p.id);

    const result = validateFeaturedIds(ids, projects);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        field: 'featured',
        code: 'featured_too_many',
      }),
    );
  });

  it('flags duplicates with featured_duplicate at the duplicate index', () => {
    const projects = [makeProject('a'), makeProject('b')];

    const result = validateFeaturedIds(
      [ID('a'), ID('b'), ID('a')],
      projects,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const dup = result.errors.filter((e) => e.code === 'featured_duplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0]?.field).toBe('featured[2]');
  });

  it('flags unknown ids with featured_unknown_or_unpublished', () => {
    const projects = [makeProject('a')];

    const result = validateFeaturedIds([ID('a'), ID('ghost')], projects);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'featured[1]',
        code: 'featured_unknown_or_unpublished',
      }),
    ]);
  });

  it('flags draft projects with featured_unknown_or_unpublished', () => {
    const projects = [makeProject('a'), makeProject('draft', 'draft')];

    const result = validateFeaturedIds([ID('a'), ID('draft')], projects);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'featured[1]',
        code: 'featured_unknown_or_unpublished',
      }),
    ]);
  });

  it('reports duplicate and unpublished violations together for the same entry', () => {
    const projects = [makeProject('a')];

    const result = validateFeaturedIds(
      [ID('ghost'), ID('a'), ID('ghost')],
      projects,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // First "ghost" -> unknown_or_unpublished at index 0.
    // Third entry -> duplicate at index 2 AND unknown_or_unpublished at index 2.
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'featured[0]',
        code: 'featured_unknown_or_unpublished',
      }),
      expect.objectContaining({
        field: 'featured[2]',
        code: 'featured_duplicate',
      }),
      expect.objectContaining({
        field: 'featured[2]',
        code: 'featured_unknown_or_unpublished',
      }),
    ]);
  });

  it('does not mutate its inputs', () => {
    const projects = [makeProject('a'), makeProject('b')];
    const ids: ProjectId[] = [ID('b'), ID('a')];
    const idsSnapshot = [...ids];
    const projectsSnapshot = projects.map((p) => ({ ...p }));

    validateFeaturedIds(ids, projects);

    expect(ids).toEqual(idsSnapshot);
    expect(projects).toEqual(projectsSnapshot);
  });

  it('ignores published-looking entries when status is draft, even when an id is provided in publishedProjects', () => {
    // Defence-in-depth: callers can pass a mixed set; only `status: published` counts.
    const projects = [makeProject('a', 'draft'), makeProject('b', 'published')];

    const result = validateFeaturedIds([ID('a')], projects);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'featured[0]',
        code: 'featured_unknown_or_unpublished',
      }),
    ]);
  });
});
