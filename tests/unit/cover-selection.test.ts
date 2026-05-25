/**
 * Unit tests for `lib/admin/cover.ts::applyCoverSelection`.
 *
 * Exercises each rejection branch and confirms the persisted
 * `coverMediaId` is byte-identical pre- and post-call:
 *
 *   - `cover_media_not_found`   (project missing OR media missing)
 *   - `cover_not_in_project`    (media exists but belongs elsewhere)
 *   - `cover_must_be_image`     (media exists, owned, but kind != image)
 *
 * Plus the success path, which is the only branch that emits a
 * `project.update` write for `coverMediaId`.
 *
 * Implementation note: `applyCoverSelection` accepts a Prisma transaction
 * client. We hand it a recording fake whose method shapes match the
 * narrow surface the helper actually consumes (`project.findUnique`,
 * `project.update`, `mediaItem.findUnique`). The fake records every
 * write so the tests can assert no `project.update` for `coverMediaId`
 * fires on any rejection branch (Requirement 5.2 / 5.3 amendments —
 * "rejection paths preserve coverMediaId").
 */

import { describe, expect, it } from 'vitest';
import { applyCoverSelection } from '@/lib/admin/cover';

// ---------------------------------------------------------------------------
// Fake Prisma transaction client
// ---------------------------------------------------------------------------

type CoverKind = 'image' | 'video' | 'model3d';

interface ProjectRow {
  readonly id: string;
  readonly slug: string;
  coverMediaId: string | null;
}

interface MediaRow {
  readonly id: string;
  readonly projectId: string;
  readonly kind: CoverKind;
}

interface ProjectUpdateCall {
  readonly where: { readonly id: string };
  readonly data: { readonly coverMediaId?: string | null };
}

function makeFakeTx(state: {
  projects: ProjectRow[];
  media: MediaRow[];
}): {
  tx: Parameters<typeof applyCoverSelection>[0];
  updates: ProjectUpdateCall[];
} {
  const updates: ProjectUpdateCall[] = [];

  const tx = {
    project: {
      findUnique: async (args: { where: { id: string } }) => {
        const row = state.projects.find((p) => p.id === args.where.id) ?? null;
        if (row === null) return null;
        // Mirror the helper's narrow `select` projection.
        return { coverMediaId: row.coverMediaId, slug: row.slug };
      },
      update: async (args: ProjectUpdateCall) => {
        updates.push(args);
        const row = state.projects.find((p) => p.id === args.where.id);
        if (row !== undefined && 'coverMediaId' in args.data) {
          row.coverMediaId = args.data.coverMediaId ?? null;
        }
        return row;
      },
    },
    mediaItem: {
      findUnique: async (args: { where: { id: string } }) => {
        const row = state.media.find((m) => m.id === args.where.id) ?? null;
        if (row === null) return null;
        return { projectId: row.projectId, kind: row.kind };
      },
    },
  } as unknown as Parameters<typeof applyCoverSelection>[0];

  return { tx, updates };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('applyCoverSelection rejection branches', () => {
  it('returns cover_media_not_found and leaves coverMediaId byte-identical when the project is missing', async () => {
    const state = {
      projects: [] as ProjectRow[],
      media: [] as MediaRow[],
    };
    const { tx, updates } = makeFakeTx(state);

    const result = await applyCoverSelection(tx, 'missing-project', 'media-1');

    expect(result).toEqual({ ok: false, code: 'cover_media_not_found' });
    expect(updates).toHaveLength(0);
    expect(state.projects).toHaveLength(0);
  });

  it('returns cover_media_not_found and leaves coverMediaId byte-identical when the media row is missing', async () => {
    const state = {
      projects: [
        { id: 'p1', slug: 'project-one', coverMediaId: 'media-existing' },
      ] as ProjectRow[],
      media: [] as MediaRow[],
    };
    const { tx, updates } = makeFakeTx(state);
    const before = state.projects[0]!.coverMediaId;

    const result = await applyCoverSelection(tx, 'p1', 'missing-media');

    expect(result).toEqual({ ok: false, code: 'cover_media_not_found' });
    expect(updates).toHaveLength(0);
    expect(state.projects[0]!.coverMediaId).toBe(before);
  });

  it('returns cover_not_in_project and leaves coverMediaId byte-identical when the media belongs to another project', async () => {
    const state = {
      projects: [
        { id: 'p1', slug: 'project-one', coverMediaId: 'media-existing' },
        { id: 'p2', slug: 'project-two', coverMediaId: null },
      ] as ProjectRow[],
      media: [
        { id: 'media-foreign', projectId: 'p2', kind: 'image' as CoverKind },
      ],
    };
    const { tx, updates } = makeFakeTx(state);
    const before = state.projects[0]!.coverMediaId;

    const result = await applyCoverSelection(tx, 'p1', 'media-foreign');

    expect(result).toEqual({ ok: false, code: 'cover_not_in_project' });
    expect(updates).toHaveLength(0);
    expect(state.projects[0]!.coverMediaId).toBe(before);
  });

  it('returns cover_must_be_image and leaves coverMediaId byte-identical for a video kind', async () => {
    const state = {
      projects: [
        { id: 'p1', slug: 'project-one', coverMediaId: 'media-existing' },
      ] as ProjectRow[],
      media: [
        { id: 'media-video', projectId: 'p1', kind: 'video' as CoverKind },
      ],
    };
    const { tx, updates } = makeFakeTx(state);
    const before = state.projects[0]!.coverMediaId;

    const result = await applyCoverSelection(tx, 'p1', 'media-video');

    expect(result).toEqual({ ok: false, code: 'cover_must_be_image' });
    expect(updates).toHaveLength(0);
    expect(state.projects[0]!.coverMediaId).toBe(before);
  });

  it('returns cover_must_be_image and leaves coverMediaId byte-identical for a model3d kind', async () => {
    const state = {
      projects: [
        { id: 'p1', slug: 'project-one', coverMediaId: null },
      ] as ProjectRow[],
      media: [
        { id: 'media-model', projectId: 'p1', kind: 'model3d' as CoverKind },
      ],
    };
    const { tx, updates } = makeFakeTx(state);
    const before = state.projects[0]!.coverMediaId;

    const result = await applyCoverSelection(tx, 'p1', 'media-model');

    expect(result).toEqual({ ok: false, code: 'cover_must_be_image' });
    expect(updates).toHaveLength(0);
    expect(state.projects[0]!.coverMediaId).toBe(before);
  });
});

describe('applyCoverSelection success path', () => {
  it('writes coverMediaId and returns the slug when the media is image-kind and owned by the project', async () => {
    const state = {
      projects: [
        { id: 'p1', slug: 'project-one', coverMediaId: null },
      ] as ProjectRow[],
      media: [
        { id: 'media-image', projectId: 'p1', kind: 'image' as CoverKind },
      ],
    };
    const { tx, updates } = makeFakeTx(state);

    const result = await applyCoverSelection(tx, 'p1', 'media-image');

    expect(result).toEqual({ ok: true, slug: 'project-one' });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      where: { id: 'p1' },
      data: { coverMediaId: 'media-image' },
    });
    expect(state.projects[0]!.coverMediaId).toBe('media-image');
  });

  it('overwrites an existing cover when the new media is image-kind and owned by the project', async () => {
    const state = {
      projects: [
        { id: 'p1', slug: 'project-one', coverMediaId: 'media-old' },
      ] as ProjectRow[],
      media: [
        { id: 'media-old', projectId: 'p1', kind: 'image' as CoverKind },
        { id: 'media-new', projectId: 'p1', kind: 'image' as CoverKind },
      ],
    };
    const { tx, updates } = makeFakeTx(state);

    const result = await applyCoverSelection(tx, 'p1', 'media-new');

    expect(result).toEqual({ ok: true, slug: 'project-one' });
    expect(updates).toHaveLength(1);
    expect(state.projects[0]!.coverMediaId).toBe('media-new');
  });
});
