'use server';

/**
 * Featured set server action.
 *
 * Reads the form's `featured` checkboxes and `featuredOrder[id]` numeric
 * fields, validates the resulting tuple set against
 * `validateFeaturedIds`, and persists the new ordering in a single
 * transaction. Always rewrites every published project's
 * `featuredOrder` so removed projects are cleared.
 */

import { revalidatePath } from 'next/cache';

import { requireAdmin } from '@/lib/auth/middleware';
import { prisma } from '@/lib/db/prisma';
import { validateFeaturedIds } from '@/lib/validation/featured';
import type { ProjectId } from '@/lib/types/domain';

export interface SaveFeaturedState {
  readonly status: 'idle' | 'success' | 'error';
  readonly message: string | null;
}

export const INITIAL_FEATURED_STATE: SaveFeaturedState = {
  status: 'idle',
  message: null,
};

function brand<B>(value: string): B {
  return value as unknown as B;
}

export async function saveFeatured(
  _prev: SaveFeaturedState,
  formData: FormData,
): Promise<SaveFeaturedState> {
  await requireAdmin();

  const checked = formData
    .getAll('featured')
    .filter((v): v is string => typeof v === 'string');

  // Build pairs of (projectId, order). When the order field is missing or
  // not numeric, fall back to the position the project was checked in.
  const pairs: Array<{ id: string; order: number }> = [];
  let fallback = 0;
  for (const id of checked) {
    const raw = formData.get(`order:${id}`);
    let parsed = Number.NaN;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      parsed = Number.parseInt(raw, 10);
    }
    const order = Number.isFinite(parsed) ? parsed : fallback++;
    pairs.push({ id, order });
  }

  // Sort by ascending order so duplicates land next to each other and the
  // resulting `orderedIds` reflects the admin's intent.
  pairs.sort((a, b) => a.order - b.order);
  const orderedIds = pairs.map((p) => brand<ProjectId>(p.id));

  // Load membership context.
  const allKnown = await prisma.project.findMany({
    select: { id: true, status: true },
  });
  const knownProjectIds = new Set<ProjectId>(
    allKnown.map((p) => brand<ProjectId>(p.id)),
  );
  const publishedProjectIds = new Set<ProjectId>(
    allKnown
      .filter((p) => p.status === 'published')
      .map((p) => brand<ProjectId>(p.id)),
  );

  const result = validateFeaturedIds(orderedIds, {
    knownProjectIds,
    publishedProjectIds,
  });

  if (!result.ok) {
    return {
      status: 'error',
      message: result.errors.map((e) => e.message).join(' '),
    };
  }

  // Persist transactionally: clear all `featuredOrder` then assign the
  // new positions per project.
  await prisma.$transaction(async (tx) => {
    await tx.project.updateMany({
      where: { featuredOrder: { not: null } },
      data: { featuredOrder: null },
    });
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i] as unknown as string;
      await tx.project.update({
        where: { id },
        data: { featuredOrder: i },
      });
    }
  });

  revalidatePath('/');
  revalidatePath('/admin');
  revalidatePath('/admin/featured');

  return {
    status: 'success',
    message: `Saved ${orderedIds.length} featured project${orderedIds.length === 1 ? '' : 's'}.`,
  };
}
