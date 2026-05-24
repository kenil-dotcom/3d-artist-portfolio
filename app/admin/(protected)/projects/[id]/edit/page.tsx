/**
 * Project editor.
 *
 * Single page covering every per-project mutation:
 *   - Title, slug, description, category, tags, software, creation date
 *   - Status (draft / published) — publish gated by `validatePublishable`
 *   - Cover media selector (any image media item attached to the project)
 *   - Media items list with alt/caption edit, reorder, and delete
 *   - File upload (multiple at once)
 *   - Project delete
 *
 * The form is split into a server-rendered shell that fetches the
 * project + supporting taxonomy and a client component that wires up
 * the server actions via `useFormState`.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { ProjectEditorForm } from '@/components/admin/ProjectEditorForm';
import { ProjectMediaManager } from '@/components/admin/ProjectMediaManager';
import { DeleteProjectForm } from '@/components/admin/DeleteProjectForm';
import { requireAdmin } from '@/lib/auth/middleware';
import { listCategories, listTags } from '@/lib/content/api';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

interface ProjectEditPageProps {
  readonly params: { readonly id: string };
  readonly searchParams: Record<string, string | string[] | undefined>;
}

export const metadata = {
  title: 'Admin · Edit project',
};

export default async function ProjectEditPage({
  params,
  searchParams,
}: ProjectEditPageProps): Promise<ReactElement> {
  await requireAdmin();

  const project = await prisma.project.findUnique({
    where: { id: params.id },
    include: {
      tags: { select: { tagId: true } },
      mediaItems: { orderBy: { ordering: 'asc' } },
    },
  });
  if (project === null) {
    notFound();
  }

  const [categories, tags] = await Promise.all([listCategories(), listTags()]);

  const justSaved =
    typeof searchParams['saved'] === 'string' &&
    searchParams['saved'] === '1';

  const initial = {
    id: project.id,
    title: project.title,
    slug: project.slug,
    description: project.description,
    categoryId: project.categoryId,
    tagIds: project.tags.map((t) => t.tagId),
    softwareUsed: [...project.softwareUsed],
    creationDate: project.creationDate.toISOString().slice(0, 10),
    status: project.status,
    coverMediaId: project.coverMediaId,
    featuredOrder:
      project.featuredOrder === null ? '' : String(project.featuredOrder),
  };

  const mediaItems = project.mediaItems.map((m) => ({
    id: m.id,
    storageKey: m.storageKey,
    mimeType: m.mimeType,
    kind: m.kind as 'image' | 'video' | 'model3d',
    altText: m.altText,
    caption: m.caption,
    ordering: m.ordering,
    width: m.width,
    height: m.height,
  }));

  return (
    <div className="space-y-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="eyebrow">Edit project</span>
          <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-semibold tracking-[-0.02em] md:text-4xl">
            {project.title}
          </h1>
          <p className="mt-2 text-sm text-muted">
            <Link
              href={`/projects/${project.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              View public page →
            </Link>
          </p>
        </div>
        <Link href="/admin/projects" className="btn-secondary px-4 py-2 text-xs">
          ← All projects
        </Link>
      </header>

      <ProjectEditorForm
        projectId={project.id}
        initial={initial}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        tags={tags.map((t) => ({ id: t.id, label: t.label }))}
        mediaItems={mediaItems.map((m) => ({
          id: m.id,
          kind: m.kind,
          storageKey: m.storageKey,
        }))}
        showSavedBanner={justSaved}
      />

      <section
        aria-labelledby="media-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-honey))]"
      >
        <h2
          id="media-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Media
        </h2>
        <p className="mt-1 text-sm text-muted">
          Drop images, videos, or glTF/GLB models. Set alt text on every
          image before publishing.
        </p>
        <div className="mt-6">
          <ProjectMediaManager projectId={project.id} mediaItems={mediaItems} />
        </div>
      </section>

      <section
        aria-labelledby="danger-heading"
        className="surface-card border-[hsl(var(--color-pop-amber))] p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-amber))]"
      >
        <h2
          id="danger-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Danger zone
        </h2>
        <p className="mt-1 text-sm text-muted">
          Deleting a project removes all of its media records too. The
          uploaded files on disk remain (clean those up separately).
        </p>
        <div className="mt-4">
          <DeleteProjectForm projectId={project.id} />
        </div>
      </section>
    </div>
  );
}
