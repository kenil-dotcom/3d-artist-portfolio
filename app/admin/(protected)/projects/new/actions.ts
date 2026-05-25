'use server';

/**
 * Create-project server action.
 *
 * Mirrors the `saveProject` create branch but is bound to a non-existent
 * id so the editor's bound action remains pure. On success, redirects to
 * the editor for the freshly-created project.
 */

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { requireAdmin } from '@/lib/auth/middleware';
import { slugify } from '@/lib/admin/slug';
import { prisma } from '@/lib/db/prisma';
import {
  SLUG_PATTERN,
  TITLE_MAX_LENGTH,
  validateProjectInput,
} from '@/lib/validation/project';
import type { CategoryId, Slug, TagId } from '@/lib/types/domain';

export interface CreateProjectState {
  readonly status: 'idle' | 'error';
  readonly message: string | null;
  readonly errors: Readonly<Record<string, string>>;
}

export const INITIAL_CREATE_STATE: CreateProjectState = {
  status: 'idle',
  message: null,
  errors: {},
};

function brand<B>(value: string): B {
  return value as unknown as B;
}

export async function createProject(
  _prev: CreateProjectState,
  formData: FormData,
): Promise<CreateProjectState> {
  await requireAdmin();

  const titleRaw = (formData.get('title') ?? '').toString().trim();
  const slugRaw = (formData.get('slug') ?? '').toString().trim();
  const descriptionRaw = (formData.get('description') ?? '').toString();
  const categoryId = (formData.get('categoryId') ?? '').toString();
  const creationDate = (formData.get('creationDate') ?? '').toString();

  // Creation always starts as `draft` (Requirement 7.5–7.6 are about
  // transitions; a brand-new project has nothing to schedule against).
  // Defensively reject any non-`draft` status the form may submit so
  // a hand-crafted payload cannot bypass the publish-readiness gate
  // that the editor's update path enforces for `scheduled` and
  // `published` transitions.
  const statusRaw = (formData.get('status') ?? 'draft').toString();
  if (statusRaw !== 'draft' && statusRaw !== '') {
    return {
      status: 'error',
      message: 'New projects must start as draft.',
      errors: { status: 'New projects must start as draft.' },
    };
  }

  const errors: Record<string, string> = {};
  if (titleRaw.length === 0) {
    errors['title'] = 'Title is required.';
  } else if (titleRaw.length > TITLE_MAX_LENGTH) {
    errors['title'] = `Title must be at most ${TITLE_MAX_LENGTH} characters.`;
  }

  const slugCandidate =
    slugRaw.length === 0
      ? slugify(titleRaw.length === 0 ? 'untitled' : titleRaw)
      : slugRaw;
  if (!SLUG_PATTERN.test(slugCandidate) || slugCandidate.length === 0) {
    errors['slug'] =
      'Slug must contain only lowercase letters, numbers, and single hyphens.';
  }

  if (categoryId.length === 0) {
    errors['categoryId'] = 'Pick a category.';
  }

  const validation = validateProjectInput(
    {
      title: titleRaw,
      description: descriptionRaw,
      slug: brand<Slug>(slugCandidate),
      categoryId: brand<CategoryId>(categoryId),
      tagIds: [] as ReadonlyArray<TagId>,
      coverMediaId: null,
      softwareUsed: [],
      creationDate: brand(creationDate),
      status: 'draft',
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

  const exists = await prisma.project.findUnique({
    where: { slug: slugCandidate },
    select: { id: true },
  });
  if (exists !== null) {
    return {
      status: 'error',
      message: null,
      errors: { slug: 'This slug is already used by another project.' },
    };
  }

  const created = await prisma.project.create({
    data: {
      slug: slugCandidate,
      title: titleRaw,
      description: descriptionRaw,
      categoryId,
      softwareUsed: [],
      creationDate: new Date(creationDate),
      status: 'draft',
    },
    select: { id: true },
  });

  revalidatePath('/admin/projects');
  redirect(`/admin/projects/${created.id}/edit?saved=1`);
}
