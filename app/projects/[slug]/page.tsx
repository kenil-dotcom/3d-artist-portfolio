/**
 * Project detail page.
 *
 * Renders title, description, category, tags, creation date, software used,
 * and the project's media items in stored order. Adjacent project links are
 * rendered using `getAdjacentProjects` against the published catalogue.
 *
 * Spec references:
 *   - Requirement 3.1 — fields rendered with placeholders for empty values.
 *   - Requirement 3.2 — media items in stored order; "no media" message
 *     when empty.
 *   - Requirement 3.9 — prev/next controls; null neighbours render disabled.
 *   - Requirement 3.10 — 404 for missing or draft slugs (handled by
 *     `getProjectBySlug` returning null).
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactElement } from 'react';

import { ResponsiveImage } from '@/components/media/ResponsiveImage';
import {
  getProjectBySlug,
  listCategories,
  listPublishedProjects,
  listTags,
} from '@/lib/content/api';
import {
  buildProjectDetail,
  PROJECT_NO_MEDIA_MESSAGE,
} from '@/lib/projects/dto';
import { getAdjacentProjects } from '@/lib/projects/navigation';
import type { MediaItem, Project } from '@/lib/types/domain';

export const dynamic = 'force-dynamic';

interface ProjectDetailPageProps {
  readonly params: { readonly slug: string };
}

export default async function ProjectDetailPage({
  params,
}: ProjectDetailPageProps): Promise<ReactElement> {
  const project = await getProjectBySlug(params.slug);
  if (project === null) {
    notFound();
  }

  const [categories, tags, allPublished] = await Promise.all([
    listCategories(),
    listTags(),
    listPublishedProjects(),
  ]);

  const category =
    categories.find((c) => c.id === project.categoryId) ?? null;
  const detail = buildProjectDetail(project, category, tags, project.mediaItems);
  const adjacent = getAdjacentProjects(allPublished, project.id);

  return (
    <article className="mx-auto max-w-5xl px-6 py-12">
      <BackBar />

      <header className="mb-12">
        <p className="eyebrow">{detail.categoryName}</p>
        <h1 className="mt-4 display-headline">
          {detail.title}.
        </h1>
        {detail.placeholders.description ? null : (
          <p className="mt-8 max-w-3xl whitespace-pre-line text-lg leading-relaxed text-muted">
            {detail.description}
          </p>
        )}

        <dl className="mt-12 grid grid-cols-1 gap-8 text-sm sm:grid-cols-3">
          <DetailField label="Created" value={detail.creationDate} placeholder={detail.placeholders.creationDate} />
          <DetailField
            label="Tags"
            value={detail.tagLabels.length > 0 ? detail.tagLabels.join(', ') : '—'}
            placeholder={detail.placeholders.tagLabels}
          />
          <DetailField
            label="Software"
            value={detail.softwareUsed.length > 0 ? detail.softwareUsed.join(', ') : '—'}
            placeholder={detail.placeholders.softwareUsed}
          />
        </dl>

        <div className="luxe-rule mt-12" aria-hidden="true" />
      </header>

      {detail.noMediaMessage ? (
        <p className="rounded-lg border border-border bg-surface px-6 py-10 text-center text-muted">
          {PROJECT_NO_MEDIA_MESSAGE}
        </p>
      ) : (
        <MediaGrid mediaItems={detail.mediaItems} title={detail.title} />
      )}

      <AdjacentNav previous={adjacent.previous} next={adjacent.next} />
    </article>
  );
}

interface DetailFieldProps {
  readonly label: string;
  readonly value: string;
  readonly placeholder: boolean;
}

function DetailField({ label, value, placeholder }: DetailFieldProps): ReactElement {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.24em] text-muted">{label}</dt>
      <dd
        className={`mt-2 text-base ${placeholder ? 'italic text-muted/70' : 'text-foreground'}`}
      >
        {value}
      </dd>
    </div>
  );
}

function BackBar(): ReactElement {
  return (
    <nav aria-label="Back to gallery" className="mb-8">
      <Link href="/gallery" className="text-sm text-muted hover:text-foreground">
        ← Back to Gallery
      </Link>
    </nav>
  );
}

interface MediaGridProps {
  readonly mediaItems: ReadonlyArray<MediaItem>;
  readonly title: string;
}

function MediaGrid({ mediaItems, title }: MediaGridProps): ReactElement {
  return (
    <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {mediaItems.map((item, idx) => (
        <li
          key={item.id as unknown as string}
          className={idx === 0 ? 'sm:col-span-2' : ''}
        >
          <MediaTile item={item} title={title} priority={idx === 0} />
        </li>
      ))}
    </ul>
  );
}

interface MediaTileProps {
  readonly item: MediaItem;
  readonly title: string;
  readonly priority: boolean;
}

function MediaTile({ item, title, priority }: MediaTileProps): ReactElement {
  if (item.kind === 'image') {
    const alt = item.altText ?? `${title} — media item ${item.ordering + 1}`;
    return (
      <a
        href={item.ref.storageKey}
        target="_blank"
        rel="noopener noreferrer"
        className="block overflow-hidden rounded-lg border border-border bg-surface"
      >
        <div className="aspect-[4/3] w-full overflow-hidden">
          <ResponsiveImage
            src={item.ref.storageKey}
            alt={alt}
            width={item.ref.width ?? 1600}
            height={item.ref.height ?? 1200}
            priority={priority}
          />
        </div>
        {item.caption !== null && item.caption.length > 0 ? (
          <p className="px-4 py-3 text-sm text-muted">{item.caption}</p>
        ) : null}
      </a>
    );
  }

  if (item.kind === 'video') {
    return (
      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <video
          controls
          className="aspect-[16/9] w-full"
          preload="metadata"
          src={item.ref.storageKey}
        >
          {item.captionsRef !== null ? (
            <track
              kind="captions"
              src={item.captionsRef.storageKey}
              srcLang="en"
              label="English"
              default
            />
          ) : null}
        </video>
        {item.caption !== null && item.caption.length > 0 ? (
          <p className="px-4 py-3 text-sm text-muted">{item.caption}</p>
        ) : null}
      </div>
    );
  }

  // model3d — render a download link for now; the inline ModelViewer is a
  // later task.
  return (
    <a
      href={item.ref.storageKey}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-6 hover:border-foreground/30"
    >
      <span className="text-sm text-foreground">3D model · {item.ref.mimeType}</span>
      <span className="text-sm text-accent">Download →</span>
    </a>
  );
}

interface AdjacentNavProps {
  readonly previous: Project | null;
  readonly next: Project | null;
}

function AdjacentNav({ previous, next }: AdjacentNavProps): ReactElement {
  return (
    <nav
      aria-label="Other projects"
      className="mt-16 flex flex-col gap-3 border-t border-border/70 pt-8 sm:flex-row sm:items-stretch sm:justify-between"
    >
      {previous === null ? (
        <span className="btn-secondary w-full opacity-40 sm:w-auto" aria-disabled="true">
          ← Newer project
        </span>
      ) : (
        <Link
          href={`/projects/${previous.slug as unknown as string}`}
          className="btn-secondary w-full sm:w-auto"
        >
          ← {previous.title}
        </Link>
      )}
      {next === null ? (
        <span className="btn-secondary w-full opacity-40 sm:w-auto" aria-disabled="true">
          Older project →
        </span>
      ) : (
        <Link
          href={`/projects/${next.slug as unknown as string}`}
          className="btn-secondary w-full sm:w-auto"
        >
          {next.title} →
        </Link>
      )}
    </nav>
  );
}
