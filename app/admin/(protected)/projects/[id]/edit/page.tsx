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
import {
  ProjectSectionEditor,
  type SectionBlockView,
  type SectionPickerMediaItem,
} from '@/components/admin/ProjectSectionEditor';
import { DeleteProjectForm } from '@/components/admin/DeleteProjectForm';
import { requireAdmin } from '@/lib/auth/middleware';
import { listCategories, listTags } from '@/lib/content/api';
import { prisma } from '@/lib/db/prisma';
import type { SectionBlockKind } from '@/lib/types/domain';

export const dynamic = 'force-dynamic';

interface ProjectEditPageProps {
  readonly params: { readonly id: string };
  readonly searchParams: Record<string, string | string[] | undefined>;
}

export const metadata = {
  title: 'Admin · Edit project',
};

/**
 * Render a `Date` as the `YYYY-MM-DDTHH:mm` string the `datetime-local`
 * input expects, using local time so the picker bounds (`min`/`max`) and
 * the prefilled value sit on the same axis. The server-side
 * `parseScheduledAt` does the authoritative UTC comparison on save.
 */
function toDateTimeLocalString(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

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

  const [categories, tags, sectionBlocks] = await Promise.all([
    listCategories(),
    listTags(),
    prisma.sectionBlock.findMany({
      where: { projectId: project.id },
      orderBy: [{ ordering: 'asc' }, { createdAt: 'asc' }],
    }),
  ]);

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
    scheduledAt:
      project.scheduledAt === null
        ? null
        : toDateTimeLocalString(project.scheduledAt),
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
    embedUrl: m.embedUrl,
  }));

  // Picker source for the Section_Editor — only attached image / video /
  // model3d Media_Items can back a Section_Block (Requirement 1.5–1.8).
  const sectionPickerMedia: ReadonlyArray<SectionPickerMediaItem> =
    project.mediaItems.map((m) => ({
      id: m.id,
      kind: m.kind as 'image' | 'video' | 'model3d',
      altText: m.altText,
      mimeType: m.mimeType,
      embedUrl: m.embedUrl,
    }));

  const sectionBlockViews: ReadonlyArray<SectionBlockView> = sectionBlocks.map(
    (b) => ({
      id: b.id,
      projectId: b.projectId,
      kind: b.kind as SectionBlockKind,
      ordering: b.ordering,
      body: b.body,
      mediaItemId: b.mediaItemId,
      mediaItemBId: b.mediaItemBId,
    }),
  );

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
          <ProjectMediaManager
            projectId={project.id}
            projectSlug={project.slug}
            projectTitle={project.title}
            status={project.status}
            hasTitle={project.title.trim().length > 0}
            hasSlug={project.slug.trim().length > 0}
            hasCategory={project.categoryId.length > 0}
            initialMedia={mediaItems}
            initialCoverMediaId={project.coverMediaId}
          />
        </div>
      </section>

      <section
        aria-labelledby="sections-heading"
        className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-honey))]"
      >
        <h2
          id="sections-heading"
          className="font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em]"
        >
          Sections
        </h2>
        <p className="mt-1 text-sm text-muted">
          Compose the project body from typed blocks: text passages,
          single images, image pairs, videos, and 3D models. Drag rows
          to reorder.
        </p>
        <div className="mt-6">
          <ProjectSectionEditor
            projectId={project.id}
            slug={project.slug}
            description={project.description}
            mediaItems={sectionPickerMedia}
            initialBlocks={sectionBlockViews}
          />
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
