/**
 * Unit tests for `lib/validation/project.ts`.
 *
 * Covers:
 *  - `validateSlug`         (regex shape, length 1..80)
 *  - `validateProjectInput` (every clause from Property 16)
 *  - `validatePublishable`  (Requirement 8.11 + 10.4 enumeration)
 */

import { describe, expect, it } from 'vitest';
import {
  DESCRIPTION_MAX_LENGTH,
  SLUG_MAX_LENGTH,
  SOFTWARE_ENTRY_MAX_LENGTH,
  SOFTWARE_USED_MAX,
  TAG_IDS_MAX,
  TITLE_MAX_LENGTH,
  validateProjectInput,
  validatePublishable,
  validateSlug,
} from '@/lib/validation/project';
import type { ProjectInput } from '@/lib/types/cms';
import type {
  CategoryId,
  IsoDate,
  IsoTimestamp,
  MediaItem,
  MediaItemId,
  Project,
  ProjectId,
  ProjectStatus,
  Slug,
  TagId,
} from '@/lib/types/domain';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TODAY = new Date('2025-01-15T12:34:56.000Z');

function makeInput(overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    title: 'A Title',
    description: '',
    slug: 'a-title' as Slug,
    categoryId: 'renders' as CategoryId,
    tagIds: [],
    coverMediaId: null,
    softwareUsed: [],
    creationDate: '2025-01-10' as IsoDate,
    status: 'draft' as ProjectStatus,
    ...overrides,
  };
}

function makeMediaItem(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'media-1' as MediaItemId,
    projectId: 'project-1' as ProjectId,
    ref: {
      storageKey: 'media/2025/cover.jpg',
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
    ...overrides,
  };
}

function makeProject(overrides: Partial<Project> = {}): Project {
  const cover: MediaItem = makeMediaItem();
  return {
    id: 'project-1' as ProjectId,
    slug: 'project-1' as Slug,
    title: 'A Title',
    description: '',
    categoryId: 'renders' as CategoryId,
    tagIds: [],
    coverMediaId: cover.id,
    mediaItems: [cover],
    softwareUsed: [],
    creationDate: '2025-01-10' as IsoDate,
    publishedAt: null,
    status: 'draft',
    featuredOrder: null,
    createdAt: '2025-01-10T00:00:00.000Z' as IsoTimestamp,
    updatedAt: '2025-01-10T00:00:00.000Z' as IsoTimestamp,
    ...overrides,
  };
}

const codes = (errors: ReadonlyArray<{ readonly field: string; readonly code: string }>) =>
  errors.map((e) => `${e.field}:${e.code}`).sort();

// ---------------------------------------------------------------------------
// validateSlug
// ---------------------------------------------------------------------------

describe('validateSlug', () => {
  it.each([
    'a',
    'abc',
    'abc-def',
    'foo-bar-baz',
    '123',
    'a1-b2-c3',
    'a'.repeat(SLUG_MAX_LENGTH),
  ])('accepts %s', (slug) => {
    expect(validateSlug(slug)).toBe(true);
  });

  it.each([
    '',                              // length 0
    '-abc',                          // leading hyphen
    'abc-',                          // trailing hyphen
    'abc--def',                      // double hyphen
    'ABC',                           // upper case
    'foo bar',                       // space
    'foo_bar',                       // underscore
    'café',                          // non-ascii
    'a'.repeat(SLUG_MAX_LENGTH + 1), // too long
  ])('rejects %s', (slug) => {
    expect(validateSlug(slug)).toBe(false);
  });

  it('rejects non-string values defensively', () => {
    expect(validateSlug(undefined as unknown as string)).toBe(false);
    expect(validateSlug(null as unknown as string)).toBe(false);
    expect(validateSlug(123 as unknown as string)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateProjectInput
// ---------------------------------------------------------------------------

describe('validateProjectInput', () => {
  it('accepts a minimal valid input', () => {
    const result = validateProjectInput(makeInput(), TODAY);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts inputs at every upper boundary', () => {
    const result = validateProjectInput(
      makeInput({
        title: 'a'.repeat(TITLE_MAX_LENGTH),
        description: 'a'.repeat(DESCRIPTION_MAX_LENGTH),
        tagIds: Array.from({ length: TAG_IDS_MAX }, (_, i) => `tag-${i}` as TagId),
        softwareUsed: Array.from({ length: SOFTWARE_USED_MAX }, () =>
          'a'.repeat(SOFTWARE_ENTRY_MAX_LENGTH)
        ),
      }),
      TODAY
    );
    expect(result.ok).toBe(true);
  });

  it('accepts published status', () => {
    const result = validateProjectInput(makeInput({ status: 'published' }), TODAY);
    expect(result.ok).toBe(true);
  });

  it('rejects an empty title with length_min', () => {
    const result = validateProjectInput(makeInput({ title: '' }), TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['title:length_min']);
    }
  });

  it('rejects a title over 120 chars with length_max', () => {
    const result = validateProjectInput(
      makeInput({ title: 'a'.repeat(TITLE_MAX_LENGTH + 1) }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['title:length_max']);
    }
  });

  it('rejects a description over 5000 chars with length_max', () => {
    const result = validateProjectInput(
      makeInput({ description: 'a'.repeat(DESCRIPTION_MAX_LENGTH + 1) }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['description:length_max']);
    }
  });

  it('rejects a missing categoryId with required', () => {
    const result = validateProjectInput(
      makeInput({ categoryId: '' as CategoryId }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['categoryId:required']);
    }
  });

  it('rejects more than 20 tagIds', () => {
    const tooMany = Array.from(
      { length: TAG_IDS_MAX + 1 },
      (_, i) => `tag-${i}` as TagId
    );
    const result = validateProjectInput(makeInput({ tagIds: tooMany }), TODAY);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContain('tagIds:length_max');
    }
  });

  it('rejects duplicate tagIds individually', () => {
    const result = validateProjectInput(
      makeInput({
        tagIds: ['a', 'b', 'a', 'c', 'a'] as unknown as ReadonlyArray<TagId>,
      }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // duplicates appear at indices 2 and 4
      expect(codes(result.errors)).toEqual([
        'tagIds[2]:duplicate',
        'tagIds[4]:duplicate',
      ]);
    }
  });

  it('rejects more than 20 softwareUsed entries', () => {
    const tooMany = Array.from({ length: SOFTWARE_USED_MAX + 1 }, () => 'Blender');
    const result = validateProjectInput(
      makeInput({ softwareUsed: tooMany }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toContain('softwareUsed:length_max');
    }
  });

  it('rejects an empty softwareUsed entry with length_min and an over-long entry with length_max', () => {
    const result = validateProjectInput(
      makeInput({
        softwareUsed: ['', 'a'.repeat(SOFTWARE_ENTRY_MAX_LENGTH + 1)],
      }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual([
        'softwareUsed[0]:length_min',
        'softwareUsed[1]:length_max',
      ]);
    }
  });

  it('rejects creationDate strictly after today as date_in_future', () => {
    const result = validateProjectInput(
      makeInput({ creationDate: '2025-01-16' as IsoDate }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['creationDate:date_in_future']);
    }
  });

  it('accepts creationDate equal to today', () => {
    const result = validateProjectInput(
      makeInput({ creationDate: '2025-01-15' as IsoDate }),
      TODAY
    );
    expect(result.ok).toBe(true);
  });

  it('rejects malformed creationDate as date_invalid', () => {
    const result = validateProjectInput(
      makeInput({ creationDate: '2025-13-40' as IsoDate }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['creationDate:date_invalid']);
    }
  });

  it('rejects an unknown status with enum_invalid', () => {
    const result = validateProjectInput(
      makeInput({ status: 'archived' as unknown as ProjectStatus }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual(['status:enum_invalid']);
    }
  });

  it('aggregates multiple errors in a single response', () => {
    const result = validateProjectInput(
      makeInput({
        title: '',
        categoryId: '' as CategoryId,
        status: 'nope' as unknown as ProjectStatus,
      }),
      TODAY
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(codes(result.errors)).toEqual([
        'categoryId:required',
        'status:enum_invalid',
        'title:length_min',
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// validatePublishable
// ---------------------------------------------------------------------------

describe('validatePublishable', () => {
  it('returns { ok: true } when every gate is satisfied', () => {
    const project = makeProject();
    expect(validatePublishable(project)).toEqual({ ok: true });
  });

  it('reports missing_title for an empty title', () => {
    const project = makeProject({ title: '   ' });
    const result = validatePublishable(project);
    expect(result).toEqual({ ok: false, missing: ['missing_title'] });
  });

  it('reports missing_cover_media when coverMediaId is null', () => {
    const project = makeProject({ coverMediaId: null });
    const result = validatePublishable(project);
    expect(result).toEqual({ ok: false, missing: ['missing_cover_media'] });
  });

  it('reports no_media_items when mediaItems is empty', () => {
    const project = makeProject({ mediaItems: [], coverMediaId: null });
    const result = validatePublishable(project);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect([...result.missing].sort()).toEqual(
      ['missing_cover_media', 'no_media_items'].sort()
    );
  });

  it('reports missing_alt_text(<id>) per offending image media item', () => {
    const m1 = makeMediaItem({ id: 'm-1' as MediaItemId, altText: '' });
    const m2 = makeMediaItem({ id: 'm-2' as MediaItemId, altText: 'ok' });
    const m3 = makeMediaItem({ id: 'm-3' as MediaItemId, altText: null });
    const m4 = makeMediaItem({
      id: 'm-4' as MediaItemId,
      kind: 'video',
      altText: null,
    }); // non-image, exempt
    const project = makeProject({
      mediaItems: [m1, m2, m3, m4],
      coverMediaId: m2.id,
    });

    const result = validatePublishable(project);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.missing).toEqual([
      'missing_alt_text(m-1)',
      'missing_alt_text(m-3)',
    ]);
  });

  it('reports every individual violation when multiple gates fail at once', () => {
    const m1 = makeMediaItem({ id: 'm-1' as MediaItemId, altText: '' });
    const project = makeProject({
      title: '',
      coverMediaId: null,
      mediaItems: [m1],
    });

    const result = validatePublishable(project);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect([...result.missing].sort()).toEqual(
      ['missing_title', 'missing_cover_media', 'missing_alt_text(m-1)'].sort()
    );
  });

  it('does not flag missing_alt_text when there are zero media items (no_media_items wins)', () => {
    const project = makeProject({ mediaItems: [], coverMediaId: null });
    const result = validatePublishable(project);
    if (result.ok) {
      throw new Error('expected failure');
    }
    expect(result.missing).not.toContain('missing_alt_text');
  });
});
