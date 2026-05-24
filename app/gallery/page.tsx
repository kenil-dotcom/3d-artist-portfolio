/**
 * Public gallery page.
 *
 * Reads filter state from URL search params, calls
 * `listGalleryProjects(query)` to filter / sort / paginate the published
 * catalogue, and renders a tile grid plus filter chips and pagination
 * controls.
 *
 * URL contract:
 *   - `page=N`      — 1-based page number; out-of-range collapses to 1
 *                     (Requirement 2.10) and shows an "out of range" notice.
 *   - `category=ID` — single category filter (chip toggles).
 *   - `tags=A,B`    — comma-separated tag ids; conjunctive ALL.
 *   - `sort=newest|oldest|title_asc` — defaults to `newest` (Req 2.5).
 *
 * Spec references:
 *   - Requirement 2.x — gallery filters, sort, pagination, and 24-tile page.
 *   - Requirement 8.7 — drafts are excluded by `listGalleryProjects`.
 */

import Link from 'next/link';
import type { ReactElement } from 'react';

import { ResponsiveImage } from '@/components/media/ResponsiveImage';
import { Reveal } from '@/components/motion/Reveal';
import { listCategories, listGalleryProjects, listTags } from '@/lib/content/api';
import type { GalleryQuery, GallerySort } from '@/lib/types/cms';
import type {
  Category,
  CategoryId,
  Project,
  Tag,
  TagId,
} from '@/lib/types/domain';

export const dynamic = 'force-dynamic';

interface GalleryPageProps {
  readonly searchParams: Record<string, string | ReadonlyArray<string> | undefined>;
}

const SORT_OPTIONS: ReadonlyArray<{ value: GallerySort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'title_asc', label: 'Title A–Z' },
];

export default async function GalleryPage({
  searchParams,
}: GalleryPageProps): Promise<ReactElement> {
  const [categories, tags] = await Promise.all([listCategories(), listTags()]);
  const query = parseQuery(searchParams, categories, tags);
  const result = await listGalleryProjects(query);

  return (
    <div className="mx-auto max-w-6xl px-6 py-24">
      <Reveal as="header" className="mb-16">
        <span className="eyebrow">Archive</span>
        <h1 className="mt-4 display-headline">
          The whole <em>gallery</em>.
        </h1>
        <p className="mt-6 max-w-2xl text-lg text-muted">
          Browse the full body of work. Filter by category, narrow with tags,
          and sort by recency or title.
        </p>
        <div className="luxe-rule mt-12" aria-hidden="true" />
      </Reveal>

      <FilterBar
        query={query}
        categories={categories}
        tags={tags}
        totalCount={result.totalCount}
      />

      {result.outOfRange ? (
        <p className="mb-6 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
          Page out of range. Showing the first page instead.
        </p>
      ) : null}

      {result.items.length === 0 ? (
        <EmptyState />
      ) : (
        <ul
          role="list"
          aria-label="Gallery projects"
          className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          {result.items.map((project, index) => (
            <Reveal
              key={project.id as unknown as string}
              as="li"
              delay={Math.min(index, 8) * 80}
            >
              <GalleryTile
                project={project}
                category={categories.find((c) => c.id === project.categoryId) ?? null}
                priority={index < 3}
              />
            </Reveal>
          ))}
        </ul>
      )}

      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        query={query}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  readonly query: GalleryQuery;
  readonly categories: ReadonlyArray<Category>;
  readonly tags: ReadonlyArray<Tag>;
  readonly totalCount: number;
}

function FilterBar({ query, categories, tags, totalCount }: FilterBarProps): ReactElement {
  const allCategoriesHref = buildHref({ ...query, page: 1, category: null });
  return (
    <section className="mb-10 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Categories</p>
          <ul role="list" className="mt-2 flex flex-wrap gap-2">
            <li>
              <Link
                href={allCategoriesHref}
                className={`chip ${query.category === null ? 'chip-active' : ''}`}
                aria-pressed={query.category === null}
              >
                All
              </Link>
            </li>
            {categories.map((cat) => {
              const active = query.category === cat.id;
              const href = buildHref({
                ...query,
                page: 1,
                category: active ? null : cat.id,
              });
              return (
                <li key={cat.id as unknown as string}>
                  <Link
                    href={href}
                    className={`chip ${active ? 'chip-active' : ''}`}
                    aria-pressed={active}
                  >
                    {cat.name}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted">Sort</p>
          <ul role="list" className="mt-2 flex flex-wrap gap-2">
            {SORT_OPTIONS.map((opt) => {
              const active = query.sort === opt.value;
              const href = buildHref({ ...query, page: 1, sort: opt.value });
              return (
                <li key={opt.value}>
                  <Link
                    href={href}
                    className={`chip ${active ? 'chip-active' : ''}`}
                    aria-pressed={active}
                  >
                    {opt.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div>
        <p className="text-xs uppercase tracking-[0.18em] text-muted">Tags</p>
        <ul role="list" className="mt-2 flex flex-wrap gap-2">
          {tags.map((tag) => {
            const active = query.tags.includes(tag.id);
            const nextTags = active
              ? query.tags.filter((t) => t !== tag.id)
              : [...query.tags, tag.id];
            const href = buildHref({ ...query, page: 1, tags: nextTags });
            return (
              <li key={tag.id as unknown as string}>
                <Link
                  href={href}
                  className={`chip ${active ? 'chip-active' : ''}`}
                  aria-pressed={active}
                >
                  {tag.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-xs text-muted">
        {totalCount} project{totalCount === 1 ? '' : 's'} match.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState(): ReactElement {
  return (
    <div className="rounded-lg border border-border bg-surface px-6 py-16 text-center">
      <p className="text-lg font-medium">No projects found</p>
      <p className="mt-2 text-sm text-muted">
        Try clearing some filters or sort options.
      </p>
      <Link href="/gallery" className="btn-secondary mt-6">
        Reset filters
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tile
// ---------------------------------------------------------------------------

interface GalleryTileProps {
  readonly project: Project;
  readonly category: Category | null;
  readonly priority: boolean;
}

function GalleryTile({ project, category, priority }: GalleryTileProps): ReactElement {
  const slug = project.slug as unknown as string;
  const cover = findCover(project);

  return (
    <Link href={`/projects/${slug}`} className="group tile-card relative">
      <div className="relative aspect-[4/3] w-full overflow-hidden">
        {cover === null ? (
          <div
            aria-hidden="true"
            className="h-full w-full bg-gradient-to-br from-surface via-background to-surface"
          />
        ) : (
          <ResponsiveImage
            src={cover.url}
            alt={cover.alt}
            width={cover.width}
            height={cover.height}
            priority={priority}
          />
        )}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent opacity-0 transition-opacity duration-500 ease-soft group-hover:opacity-100 group-focus-visible:opacity-100"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-4 bottom-4 translate-y-2 opacity-0 transition-all duration-500 ease-pop group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
        >
          <p className="font-[family-name:var(--font-display)] text-xl font-semibold leading-tight tracking-[-0.02em] text-white">
            {project.title}
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-white/80">
            {category?.name ?? 'Uncategorised'}
          </p>
        </div>
      </div>
      <div className="px-5 py-5">
        <p className="text-base font-normal text-foreground">{project.title}</p>
        <p className="mt-1 text-[10px] uppercase tracking-[0.2em] text-muted">
          {category?.name ?? 'Uncategorised'}
        </p>
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface PaginationProps {
  readonly page: number;
  readonly totalPages: number;
  readonly query: GalleryQuery;
}

function Pagination({ page, totalPages, query }: PaginationProps): ReactElement | null {
  if (totalPages <= 1) return null;

  const prevHref = buildHref({ ...query, page: Math.max(1, page - 1) });
  const nextHref = buildHref({ ...query, page: Math.min(totalPages, page + 1) });
  const isFirst = page <= 1;
  const isLast = page >= totalPages;

  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-3">
      {isFirst ? (
        <span className="btn-secondary opacity-40" aria-disabled="true">
          ← Previous
        </span>
      ) : (
        <Link href={prevHref} className="btn-secondary">
          ← Previous
        </Link>
      )}
      <span className="text-sm text-muted">
        Page {page} of {totalPages}
      </span>
      {isLast ? (
        <span className="btn-secondary opacity-40" aria-disabled="true">
          Next →
        </span>
      ) : (
        <Link href={nextHref} className="btn-secondary">
          Next →
        </Link>
      )}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Helpers — query parsing and href building
// ---------------------------------------------------------------------------

function findCover(project: Project): {
  url: string;
  alt: string;
  width: number;
  height: number;
} | null {
  const all = project.mediaItems;
  let item =
    project.coverMediaId === null
      ? null
      : (all.find(
          (m) => (m.id as unknown as string) === (project.coverMediaId as unknown as string),
        ) ?? null);
  if (item === null) {
    item = all.find((m) => m.kind === 'image') ?? null;
  }
  if (item === null) return null;
  return {
    url: item.ref.storageKey,
    alt: item.altText ?? `${project.title} cover image`,
    width: item.ref.width ?? 1600,
    height: item.ref.height ?? 1200,
  };
}

function readSingleParam(
  params: GalleryPageProps['searchParams'],
  key: string,
): string | null {
  const raw = params[key];
  if (raw === undefined) return null;
  if (typeof raw === 'string') {
    return raw.length > 0 ? raw : null;
  }
  const first = raw[0];
  return typeof first === 'string' && first.length > 0 ? first : null;
}

function readMultiParam(
  params: GalleryPageProps['searchParams'],
  key: string,
): ReadonlyArray<string> {
  const raw = params[key];
  if (raw === undefined) return [];
  const values: string[] = [];
  if (typeof raw === 'string') {
    values.push(...raw.split(','));
  } else {
    for (const v of raw) {
      values.push(...v.split(','));
    }
  }
  return values.map((v) => v.trim()).filter((v) => v.length > 0);
}

function parseSort(value: string | null): GallerySort {
  if (value === 'oldest') return 'oldest';
  if (value === 'title_asc') return 'title_asc';
  return 'newest';
}

function parsePage(value: string | null): number {
  if (value === null) return 1;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

function parseQuery(
  searchParams: GalleryPageProps['searchParams'],
  categories: ReadonlyArray<Category>,
  tags: ReadonlyArray<Tag>,
): GalleryQuery {
  const page = parsePage(readSingleParam(searchParams, 'page'));
  const sort = parseSort(readSingleParam(searchParams, 'sort'));

  const rawCategory = readSingleParam(searchParams, 'category');
  const validCategoryIds = new Set(
    categories.map((c) => c.id as unknown as string),
  );
  const category =
    rawCategory !== null && validCategoryIds.has(rawCategory)
      ? (rawCategory as unknown as CategoryId)
      : null;

  const rawTags = readMultiParam(searchParams, 'tags');
  const validTagIds = new Set(tags.map((t) => t.id as unknown as string));
  const tagIds: ReadonlyArray<TagId> = rawTags
    .filter((t) => validTagIds.has(t))
    .map((t) => t as unknown as TagId);

  return { page, category, tags: tagIds, sort };
}

function buildHref(query: GalleryQuery): string {
  const sp = new URLSearchParams();
  if (query.page !== 1) sp.set('page', String(query.page));
  if (query.category !== null) sp.set('category', query.category as unknown as string);
  if (query.tags.length > 0) {
    sp.set('tags', query.tags.map((t) => t as unknown as string).join(','));
  }
  if (query.sort !== 'newest') sp.set('sort', query.sort);
  const qs = sp.toString();
  return qs.length === 0 ? '/gallery' : `/gallery?${qs}`;
}
