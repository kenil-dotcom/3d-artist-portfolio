/**
 * Project detail page — ArtStation-inspired vertical scroll layout.
 *
 * Layout:
 *   - Hero: first media item, full-width, with the title overlay.
 *   - Sticky right-side metadata column on desktop (320 px); collapses
 *     to a top inline block on mobile.
 *   - Vertical media stack of remaining items (max-w-[960px] centred).
 *   - Adjacent project tiles at the bottom.
 *   - CSS scroll-snap proximity so the page reads as a tour without
 *     fighting the user's wheel.
 *
 * Spec references:
 *   - Requirement 3.1 — title, description, category, tags, creation date,
 *     software used; placeholders when empty.
 *   - Requirement 3.2 — media items in stored order; "no media" message
 *     when empty.
 *   - Requirement 3.9 — disabled prev/next at the endpoints.
 *   - Requirement 3.10 — 404 for missing or draft slugs.
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
import { getAdjacentProjects } from '@/lib/projects/adjacent';
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
  const adjacent = getAdjacentProjects(allPublished, project.slug);

  const [hero, ...rest] = detail.mediaItems;

  return (
    <div className="bg-background text-foreground">
      <BackBar />

      {hero === undefined ? (
        <div className="mx-auto max-w-3xl px-6 py-24 text-center">
          <p className="eyebrow">{detail.categoryName}</p>
          <h1 className="mt-6 display-headline">{detail.title}.</h1>
          <p className="mt-12 rounded-3xl border-2 border-dashed border-foreground/30 bg-surface px-6 py-10 text-muted">
            {PROJECT_NO_MEDIA_MESSAGE}
          </p>
          <AdjacentNav previous={adjacent.prev} next={adjacent.next} />
        </div>
      ) : (
        <>
          <Hero
            media={hero}
            title={detail.title}
            categoryName={detail.categoryName}
            creationDate={detail.creationDate}
            placeholders={{
              title: detail.placeholders.title,
              creationDate: detail.placeholders.creationDate,
            }}
          />

          <div
            className="mx-auto grid max-w-[1440px] grid-cols-1 gap-12 px-6 py-12 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-16 lg:py-16"
            style={{ scrollSnapType: 'y proximity' }}
          >
            <div className="order-2 min-w-0 lg:order-1">
              <MediaStack mediaItems={rest} title={detail.title} />
              <AdjacentNav previous={adjacent.prev} next={adjacent.next} />
            </div>
            <Sidebar detail={detail} />
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

interface HeroProps {
  readonly media: MediaItem;
  readonly title: string;
  readonly categoryName: string;
  readonly creationDate: string;
  readonly placeholders: {
    readonly title: boolean;
    readonly creationDate: boolean;
  };
}

function Hero({
  media,
  title,
  categoryName,
  creationDate,
  placeholders,
}: HeroProps): ReactElement {
  const alt =
    media.altText ?? `${title} — hero image`;
  const isImage = media.kind === 'image' && media.embedUrl === null;
  const isEmbed = media.embedUrl !== null;
  const isVideo = media.kind === 'video' && !isEmbed;

  return (
    <section
      aria-label="Hero"
      className="relative w-full overflow-hidden border-b-2 border-foreground bg-foreground"
      style={{ scrollSnapAlign: 'start' }}
    >
      <div className="relative w-full">
        {isImage ? (
          <ResponsiveImage
            src={media.ref.storageKey}
            alt={alt}
            width={media.ref.width ?? 2400}
            height={media.ref.height ?? 1350}
            priority
            className="block w-full"
          />
        ) : null}

        {isVideo ? (
          <video
            controls
            preload="metadata"
            className="block aspect-[16/9] w-full bg-foreground"
            src={media.ref.storageKey}
          >
            {media.captionsRef !== null ? (
              <track
                kind="captions"
                src={media.captionsRef.storageKey}
                srcLang="en"
                label="English"
                default
              />
            ) : null}
          </video>
        ) : null}

        {isEmbed ? (
          <div className="relative aspect-[16/9] w-full bg-foreground">
            <iframe
              src={media.embedUrl ?? ''}
              title={`${title} — embedded video`}
              className="absolute inset-0 h-full w-full"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        ) : null}

        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-background via-background/60 to-transparent"
        />

        <div className="absolute inset-x-0 bottom-0 px-6 pb-8 md:px-12 md:pb-12">
          <div className="mx-auto max-w-[1440px]">
            <p className="eyebrow">{categoryName}</p>
            <h1
              className={`mt-4 display-headline ${
                placeholders.title ? 'italic text-muted/70' : ''
              }`}
            >
              {title}.
            </h1>
            <p
              className={`mt-4 text-sm uppercase tracking-[0.18em] ${
                placeholders.creationDate ? 'italic text-muted/70' : 'text-muted'
              }`}
            >
              {creationDate}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SidebarProps {
  readonly detail: ReturnType<typeof buildProjectDetail>;
}

function Sidebar({ detail }: SidebarProps): ReactElement {
  return (
    <aside
      aria-label="Project details"
      className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start"
    >
      <div className="surface-card p-6 shadow-[6px_6px_0_0_hsl(var(--color-pop-caramel))]">
        <span className="eyebrow">{detail.categoryName}</span>
        <h2
          className={`mt-4 font-[family-name:var(--font-display)] text-2xl font-semibold tracking-[-0.02em] ${
            detail.placeholders.title ? 'italic text-muted/70' : ''
          }`}
        >
          {detail.title}
        </h2>
        <p
          className={`mt-4 whitespace-pre-line text-sm leading-relaxed ${
            detail.placeholders.description ? 'italic text-muted/70' : 'text-muted'
          }`}
        >
          {detail.description}
        </p>

        <dl className="mt-6 space-y-4 text-sm">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.24em] text-muted">
              Created
            </dt>
            <dd
              className={`mt-1 ${
                detail.placeholders.creationDate
                  ? 'italic text-muted/70'
                  : 'text-foreground'
              }`}
            >
              {detail.creationDate}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.24em] text-muted">
              Tags
            </dt>
            <dd className="mt-2">
              {detail.tagLabels.length === 0 ? (
                <span className="italic text-muted/70">—</span>
              ) : (
                <ul role="list" className="flex flex-wrap gap-2">
                  {detail.tagLabels.map((label) => (
                    <li key={label}>
                      <span className="chip">{label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.24em] text-muted">
              Software
            </dt>
            <dd className="mt-2">
              {detail.softwareUsed.length === 0 ? (
                <span className="italic text-muted/70">—</span>
              ) : (
                <ul role="list" className="flex flex-wrap gap-1.5">
                  {detail.softwareUsed.map((entry) => (
                    <li
                      key={entry}
                      className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-honey))] px-3 py-1 text-xs font-semibold text-foreground"
                    >
                      {entry}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </div>
        </dl>

        <div className="luxe-rule mt-8" aria-hidden="true" />

        <Link
          href="/commission"
          data-cursor-label="Hire"
          className="btn-primary mt-8 w-full justify-center"
        >
          Hire me for similar work
        </Link>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Media stack
// ---------------------------------------------------------------------------

interface MediaStackProps {
  readonly mediaItems: ReadonlyArray<MediaItem>;
  readonly title: string;
}

function MediaStack({ mediaItems, title }: MediaStackProps): ReactElement | null {
  if (mediaItems.length === 0) return null;
  return (
    <ul role="list" className="mx-auto max-w-[960px] space-y-12">
      {mediaItems.map((item, idx) => (
        <li
          key={item.id as unknown as string}
          style={{ scrollSnapAlign: 'start' }}
        >
          <MediaBlock item={item} title={title} index={idx} />
        </li>
      ))}
    </ul>
  );
}

interface MediaBlockProps {
  readonly item: MediaItem;
  readonly title: string;
  readonly index: number;
}

function MediaBlock({ item, title, index }: MediaBlockProps): ReactElement {
  const captionEl =
    item.caption !== null && item.caption.length > 0 ? (
      <p className="mt-3 text-center text-sm italic text-muted">
        {item.caption}
      </p>
    ) : null;

  if (item.embedUrl !== null) {
    return (
      <figure>
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border-2 border-foreground bg-foreground shadow-[8px_8px_0_0_hsl(var(--color-pop-caramel))]">
          <iframe
            src={item.embedUrl}
            title={`${title} — embedded video ${index + 2}`}
            className="absolute inset-0 h-full w-full"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {captionEl}
      </figure>
    );
  }

  if (item.kind === 'image') {
    const alt = item.altText ?? `${title} — media item ${item.ordering + 1}`;
    return (
      <figure>
        <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-surface shadow-[8px_8px_0_0_hsl(var(--color-pop-honey))]">
          <ResponsiveImage
            src={item.ref.storageKey}
            alt={alt}
            width={item.ref.width ?? 1600}
            height={item.ref.height ?? 1200}
          />
        </div>
        {captionEl}
      </figure>
    );
  }

  if (item.kind === 'video') {
    return (
      <figure>
        <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-foreground shadow-[8px_8px_0_0_hsl(var(--color-pop-caramel))]">
          <video
            controls
            preload="metadata"
            className="aspect-[16/9] w-full"
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
        </div>
        {captionEl}
      </figure>
    );
  }

  // 3D model — keep the inline download link.
  return (
    <figure>
      <a
        href={item.ref.storageKey}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between rounded-3xl border-2 border-foreground bg-surface px-6 py-8 shadow-[8px_8px_0_0_hsl(var(--color-pop-sage))] hover:bg-background"
      >
        <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-[-0.02em]">
          3D model · {item.ref.mimeType}
        </span>
        <span className="rounded-full border-2 border-foreground bg-[hsl(var(--color-pop-honey))] px-4 py-1.5 text-xs font-bold uppercase tracking-[0.16em]">
          Download →
        </span>
      </a>
      {captionEl}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

function BackBar(): ReactElement {
  return (
    <nav aria-label="Back to gallery" className="mx-auto max-w-[1440px] px-6 pt-8">
      <Link
        href="/gallery"
        className="text-sm text-muted hover:text-foreground"
      >
        ← Back to Gallery
      </Link>
    </nav>
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
      className="mx-auto mt-20 grid max-w-[960px] grid-cols-1 gap-4 border-t-2 border-foreground/20 pt-8 md:grid-cols-2"
    >
      <AdjacentTile project={previous} direction="prev" />
      <AdjacentTile project={next} direction="next" />
    </nav>
  );
}

function AdjacentTile({
  project,
  direction,
}: {
  readonly project: Project | null;
  readonly direction: 'prev' | 'next';
}): ReactElement {
  const label = direction === 'prev' ? '← Newer project' : 'Older project →';

  if (project === null) {
    return (
      <div
        aria-disabled="true"
        className="surface-card flex items-center justify-between gap-4 p-5 opacity-40"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted">{label}</p>
        <p className="text-sm italic text-muted">No more projects this way</p>
      </div>
    );
  }

  const cover = findCover(project);
  return (
    <Link
      href={`/projects/${project.slug as unknown as string}`}
      className="group flex items-center gap-4 rounded-3xl border-2 border-foreground bg-background p-3 shadow-[6px_6px_0_0_hsl(var(--color-pop-honey))] transition-all ease-pop hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[8px_8px_0_0_hsl(var(--color-pop-honey))]"
    >
      <div className="relative h-20 w-28 shrink-0 overflow-hidden rounded-xl border-2 border-foreground bg-surface">
        {cover === null ? (
          <div
            aria-hidden="true"
            className="h-full w-full bg-gradient-to-br from-surface via-background to-surface"
          />
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={cover.url}
            alt={cover.alt}
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted">
          {label}
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-foreground">
          {project.title}
        </p>
      </div>
    </Link>
  );
}

function findCover(project: Project): {
  url: string;
  alt: string;
} | null {
  const all = project.mediaItems;
  let item =
    project.coverMediaId === null
      ? null
      : (all.find(
          (m) =>
            (m.id as unknown as string) === (project.coverMediaId as unknown as string),
        ) ?? null);
  if (item === null) {
    item = all.find((m) => m.kind === 'image') ?? null;
  }
  if (item === null) return null;
  return {
    url: item.ref.storageKey,
    alt: item.altText ?? `${project.title} cover image`,
  };
}
