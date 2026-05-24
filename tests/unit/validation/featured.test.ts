import { describe, expect, it } from 'vitest';

import {
  FEATURED_MAX,
  validateFeaturedIds,
  type FeaturedValidationContext,
} from '@/lib/validation/featured';
import type { ProjectId } from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const ID = (raw: string): ProjectId => raw as unknown as ProjectId;

function makeContext(opts: {
  readonly knownIds?: ReadonlyArray<string>;
  readonly publishedIds?: ReadonlyArray<string>;
}): FeaturedValidationContext {
  return {
    knownProjectIds: new Set((opts.knownIds ?? []).map(ID)),
    publishedProjectIds: new Set((opts.publishedIds ?? []).map(ID)),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('validateFeaturedIds', () => {
  it('accepts an empty list', () => {
    const result = validateFeaturedIds([], makeContext({}));
    expect(result).toEqual({ ok: true });
  });

  it('accepts a fully published, distinct list of any length up to 12', () => {
    const ids = Array.from({ length: FEATURED_MAX }, (_, i) => `p${i}`);
    const ctx = makeContext({ knownIds: ids, publishedIds: ids });

    const result = validateFeaturedIds(ids.map(ID), ctx);
    expect(result).toEqual({ ok: true });
  });

  it('rejects lists longer than 12 with too_many', () => {
    const ids = Array.from({ length: 13 }, (_, i) => `p${i}`);
    const ctx = makeContext({ knownIds: ids, publishedIds: ids });

    const result = validateFeaturedIds(ids.map(ID), ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ field: 'featured', code: 'too_many' }),
    );
  });

  it('flags duplicates with the duplicate code at the duplicate index', () => {
    const ctx = makeContext({ knownIds: ['a', 'b'], publishedIds: ['a', 'b'] });

    const result = validateFeaturedIds([ID('a'), ID('b'), ID('a')], ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const dup = result.errors.filter((e) => e.code === 'duplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0]?.field).toBe('featured[2]');
  });

  it('flags ids absent from knownProjectIds with unknown_project', () => {
    const ctx = makeContext({ knownIds: ['a'], publishedIds: ['a'] });

    const result = validateFeaturedIds([ID('a'), ID('ghost')], ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'featured[1]',
        code: 'unknown_project',
      }),
    ]);
  });

  it('flags known but unpublished projects with unpublished_project', () => {
    const ctx = makeContext({ knownIds: ['a', 'draft'], publishedIds: ['a'] });

    const result = validateFeaturedIds([ID('a'), ID('draft')], ctx);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'featured[1]',
        code: 'unpublished_project',
      }),
    ]);
  });

  it('reports duplicate and unknown violations together for the same entry', () => {
    const ctx = makeContext({ knownIds: ['a'], publishedIds: ['a'] });

    const result = validateFeaturedIds(
      [ID('ghost'), ID('a'), ID('ghost')],
      ctx,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([
      expect.objectContaining({
        field: 'featured[0]',
        code: 'unknown_project',
      }),
      expect.objectContaining({
        field: 'featured[2]',
        code: 'duplicate',
      }),
      expect.objectContaining({
        field: 'featured[2]',
        code: 'unknown_project',
      }),
    ]);
  });

  it('does not mutate the supplied id list', () => {
    const ctx = makeContext({ knownIds: ['a', 'b'], publishedIds: ['a', 'b'] });
    const ids: ProjectId[] = [ID('b'), ID('a')];
    const snapshot = [...ids];

    validateFeaturedIds(ids, ctx);

    expect(ids).toEqual(snapshot);
  });
});
