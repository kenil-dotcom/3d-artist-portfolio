/**
 * Project detail page — ArtStation-inspired vertical scroll layout.
 *
 * Layout:
 *   - Hero: first media item, full-width, with the title overlay.
 *   - Sticky right-side metadata column on desktop (320 px); collapses
 *     to a top inline block on mobile.
 *   - Body: when the project has Section_Blocks they drive the primary
 *     body content (Requirement 16.1); otherwise we fall back to the
 *     legacy media-stack rendering plus the sidebar description
 *     (Requirement 16.2).
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
 *   - Requirement 6.5 — `ResponsiveImage` consumes the Variant_Set.
 *   - Requirement 16.1–16.12 — typed Section_Blocks rendered beneath
 *     the hero with skip-on-missing semantics.
 *
 * CSP note: when a project carries at least one renderable `model3d`
 * Section_Block we inject a `<script type="module">` tag pointing at
 * `https://unpkg.com/@google/model-viewer@latest/dist/model-viewer.min.js`.
 * The page-level CSP must include the `https://unpkg.com` origin in both
 * the `script-src` and `connect-src` directives so the browser can load
 * the bundle and fetch the GLB/GLTF assets the component pulls
 * relatively. Text-only case studies never inject the tag and therefore
 * do not need the unpkg origin.
 */

import Link from 'next/link';
import { notFound } from 'next/navigation';
import sanitizeHtml from 'sanitize-html';
import type { ReactElement } from 'react';

import { ResponsiveImage } from '@/components/media/ResponsiveImage';
import {
  getProjectBySlug,
  listCategories,
  listPublishedProjects,
  listTags,
} from '@/lib/content/api';
import { prisma } from '@/lib/db/prisma';
import {
  buildProjectDetail,
  PROJECT_NO_MEDIA_MESSAGE,
} from '@/lib/projects/dto';
import { getAdjacentProjects } from '@/lib/projects/adjacent';
import type {
  MediaItem,
  MediaItemId,
  Project,
  SectionBlock,
  SectionBlockKind,
} from '@/lib/types/domain';

export const dynamic = 'force-dynamic';

/**
 * Web-component runtime for `<model-viewer>` (Requirement 16.9). Loaded
 * from unpkg only when at least one Section_Block resolves to a
 * renderable `glb`/`gltf`/`usdz` Media_Item so text-only case studies
 * stay script-free.
 */
const MODEL_VIEWER_SCRIPT_SRC =
  'https://unpkg.com/@google/model-viewer@latest/dist/model-viewer.min.js';

/**
 * Maximum number of characters of a sanitised text-block body that the
 * public renderer will surface (Requirement 16.3). The editor enforces
 * 10 000; legacy seeded blocks may carry up to 50 000 characters of
 * `Project.description`, so this 20 000-character ceiling is a defensive
 * upper bound rather than an authoring limit.
 */
const TEXT_BLOCK_MAX_RENDERED_CHARS = 20_000;

/**
 * Allow-list passed to `sanitize-html` for `text` block bodies on the
 * public render path. Mirrors the server-side allow-list used by
 * `lib/admin/sectionBlocks.ts` so a row that bypassed the editor
 * (legacy seed, hand-edited migration) still goes through the same
 * trust boundary before reaching the visitor. HTTPS is the only
 * permitted URL scheme on `<a>` hrefs.
 */
const TEXT_BLOCK_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['https'],
};

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

  const [categories, tags, allPublished, sectionBlocks] = await Promise.all([
    listCategories(),
    listTags(),
    listPublishedProjects(),
    loadSectionBlocks(project.id as unknown as string),
  ]);

  const category =
    categories.find((c) => c.id === project.categoryId) ?? null;
  const detail = buildProjectDetail(project, category, tags, project.mediaItems);
  const adjacent = getAdjacentProjects(allPublished, project.slug);

  const [hero, ...rest] = detail.mediaItems;

  // Build a Media_Item index keyed by id so the Section_Block renderer
  // can resolve `mediaItemId` / `mediaItemBId` references in O(1)
  // without re-querying Prisma per block (Requirement 16.5–16.12).
  const mediaIndex = new Map<string, MediaItem>();
  for (const m of project.mediaItems) {
    mediaIndex.set(m.id as unknown as string, m);
  }

  // Pre-compute whether any model3d block resolves to a renderable
  // Media_Item so we only inject the `<model-viewer>` runtime when the
  // visitor will actually see one (Requirement 16.9).
  const needsModelViewerRuntime = sectionBlocks.some((b) =>
    blockNeedsModelViewerRuntime(b, mediaIndex),
  );

  return (
    <div className="bg-background text-foreground">
      {needsModelViewerRuntime ? (
        // CSP allowlist requirement: `script-src https://unpkg.com` and
        // `connect-src https://unpkg.com`. Only emitted for projects
        // that resolve at least one renderable `model3d` block so
        // text-only case studies stay script-free.
        // eslint-disable-next-line @next/next/no-sync-scripts
        <script type="module" src={MODEL_VIEWER_SCRIPT_SRC} />
      ) : null}

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
              {sectionBlocks.length > 0 ? (
                <SectionBlockList
                  blocks={sectionBlocks}
                  mediaIndex={mediaIndex}
                  title={detail.title}
                />
              ) : (
                <>
                  <DescriptionFallback
                    description={project.description}
                    title={detail.title}
                  />
                  <MediaStack mediaItems={rest} title={detail.title} />
                </>
              )}
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
// Section block loading
// ---------------------------------------------------------------------------

/**
 * Shape returned by `prisma.sectionBlock.findMany` after we narrow the
 * branded id types. The page never mutates the rows; the readonly
 * envelope makes that explicit.
 */
type LoadedSectionBlock = Pick<
  SectionBlock,
  'kind' | 'ordering' | 'body' | 'mediaItemId' | 'mediaItemBId'
> & { readonly id: string };

/**
 * Load the project's Section_Blocks ordered by `(ordering ASC, createdAt ASC)`
 * so deterministic rendering survives the rare tie when two blocks share
 * the same `ordering` mid-reorder (Requirement 16.1). Returns the empty
 * list on database errors so a transient outage falls back to the
 * legacy description-driven body rather than throwing into the visitor's
 * face.
 */
async function loadSectionBlocks(
  projectId: string,
): Promise<ReadonlyArray<LoadedSectionBlock>> {
  try {
    const rows = await prisma.sectionBlock.findMany({
      where: { projectId },
      orderBy: [{ ordering: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        kind: true,
        ordering: true,
        body: true,
        mediaItemId: true,
        mediaItemBId: true,
      },
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind as SectionBlockKind,
      ordering: row.ordering,
      body: row.body,
      mediaItemId:
        row.mediaItemId === null
          ? null
          : (row.mediaItemId as unknown as MediaItemId),
      mediaItemBId:
        row.mediaItemBId === null
          ? null
          : (row.mediaItemBId as unknown as MediaItemId),
    }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn('[project-detail] loadSectionBlocks failed:', message);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Section block renderer
// ---------------------------------------------------------------------------

/**
 * Resolve a single Media_Item by id from the per-project lookup map.
 * Returns `null` when the id is missing, the row is absent, or the row
 * has no `storageKey` — every "skip the block" branch in Requirement
 * 16.12 collapses into a single null-check in the renderer above.
 */
function resolveMedia(
  id: MediaItemId | null,
  mediaIndex: ReadonlyMap<string, MediaItem>,
): MediaItem | null {
  if (id === null) return null;
  const row = mediaIndex.get(id as unknown as string) ?? null;
  if (row === null) return null;
  if (typeof row.ref.storageKey !== 'string' || row.ref.storageKey.length === 0) {
    return null;
  }
  return row;
}

/**
 * Decide whether a Section_Block contributes a renderable `<model-viewer>`
 * element to the page so the parent component can decide whether to
 * inject the unpkg runtime. Only `glb` and `gltf` extensions trigger the
 * runtime — `usdz` uses the native `<a rel="ar">` Quick Look anchor and
 * never touches the model-viewer script (Requirement 16.10).
 */
function blockNeedsModelViewerRuntime(
  block: LoadedSectionBlock,
  mediaIndex: ReadonlyMap<string, MediaItem>,
): boolean {
  if (block.kind !== 'model3d') return false;
  const media = resolveMedia(block.mediaItemId, mediaIndex);
  if (media === null) return false;
  const ext = media.extension?.toLowerCase() ?? null;
  return ext === 'glb' || ext === 'gltf';
}

interface SectionBlockListProps {
  readonly blocks: ReadonlyArray<LoadedSectionBlock>;
  readonly mediaIndex: ReadonlyMap<string, MediaItem>;
  readonly title: string;
}

/**
 * Iterate the project's Section_Blocks and render each one through
 * `SectionBlockRenderer`. Any `null` return is dropped and rendering
 * continues with the next block — Requirement 16.12's "skip-on-missing,
 * never error to the visitor" semantics live here.
 */
function SectionBlockList({
  blocks,
  mediaIndex,
  title,
}: SectionBlockListProps): ReactElement {
  return (
    <div className="mx-auto max-w-[960px] space-y-12">
      {blocks.map((block, index) => {
        const node = renderSectionBlock(block, mediaIndex, title, index);
        if (node === null) return null;
        return (
          <section
            key={block.id}
            style={{ scrollSnapAlign: 'start' }}
            data-block-kind={block.kind}
          >
            {node}
          </section>
        );
      })}
    </div>
  );
}

/**
 * Switch over the Section_Block kind and dispatch to the per-kind
 * renderer. Returns `null` for any unrenderable block so the caller can
 * skip it and continue (Requirement 16.4 / 16.11 / 16.12). The function
 * is intentionally pure and cheap so it can be exercised in isolation
 * by the property tests in task 8.4.
 */
function renderSectionBlock(
  block: LoadedSectionBlock,
  mediaIndex: ReadonlyMap<string, MediaItem>,
  title: string,
  index: number,
): ReactElement | null {
  switch (block.kind) {
    case 'text':
      return renderTextBlock(block);
    case 'image':
      return renderImageBlock(block, mediaIndex, title, index);
    case 'image_pair':
      return renderImagePairBlock(block, mediaIndex, title, index);
    case 'video':
      return renderVideoBlock(block, mediaIndex, title, index);
    case 'model3d':
      return renderModel3dBlock(block, mediaIndex, title);
  }
}

function renderTextBlock(block: LoadedSectionBlock): ReactElement | null {
  const raw = typeof block.body === 'string' ? block.body : '';
  // Re-sanitise on the render path even though the editor sanitises on
  // save (defence in depth — legacy seed blocks bypass the editor).
  const sanitised = sanitizeHtml(raw, TEXT_BLOCK_SANITIZE_OPTIONS);
  const trimmed = sanitised.trim();
  if (trimmed.length === 0) {
    // Empty / whitespace-only body — Requirement 16.4: skip silently.
    return null;
  }
  const capped =
    trimmed.length > TEXT_BLOCK_MAX_RENDERED_CHARS
      ? trimmed.slice(0, TEXT_BLOCK_MAX_RENDERED_CHARS)
      : trimmed;
  return (
    <div
      className="prose-block mx-auto max-w-[720px] space-y-4 text-base leading-relaxed text-foreground [&_a]:text-foreground [&_a]:underline [&_a:hover]:text-muted [&_li]:ml-6 [&_ol]:list-decimal [&_p]:whitespace-pre-line [&_ul]:list-disc"
      dangerouslySetInnerHTML={{ __html: capped }}
    />
  );
}

function renderImageBlock(
  block: LoadedSectionBlock,
  mediaIndex: ReadonlyMap<string, MediaItem>,
  title: string,
  index: number,
): ReactElement | null {
  const media = resolveMedia(block.mediaItemId, mediaIndex);
  if (media === null) return null;
  return (
    <figure>
      <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-surface shadow-[8px_8px_0_0_hsl(var(--color-pop-honey))]">
        <ResponsiveImage
          src={media.ref.storageKey}
          alt={media.altText ?? `${title} — section image ${index + 1}`}
          width={media.ref.width ?? 1600}
          height={media.ref.height ?? 1200}
          variantSet={media.variantSet}
        />
      </div>
      {renderCaption(media)}
    </figure>
  );
}

function renderImagePairBlock(
  block: LoadedSectionBlock,
  mediaIndex: ReadonlyMap<string, MediaItem>,
  title: string,
  index: number,
): ReactElement | null {
  const left = resolveMedia(block.mediaItemId, mediaIndex);
  const right = resolveMedia(block.mediaItemBId, mediaIndex);

  // Both missing — skip the block entirely (Requirement 16.12).
  if (left === null && right === null) return null;

  // Partial availability — render the surviving image as a single
  // column without raising an error (Requirement 16.7).
  if (left === null || right === null) {
    const survivor = (left ?? right) as MediaItem;
    return renderImagePairSingleSurvivor(survivor, title, index);
  }

  // Both present — Requirement 16.6: two columns at >= 768 px, single
  // stacked column below 768 px. We use Tailwind's `md:` breakpoint
  // which is anchored to a 768 px min-width media query.
  return (
    <figure>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <ImagePairFigureItem media={left} title={title} index={index} slot={0} />
        <ImagePairFigureItem media={right} title={title} index={index} slot={1} />
      </div>
    </figure>
  );
}

function renderImagePairSingleSurvivor(
  survivor: MediaItem,
  title: string,
  index: number,
): ReactElement {
  return (
    <figure>
      <div className="grid grid-cols-1 gap-6">
        <ImagePairFigureItem media={survivor} title={title} index={index} slot={0} />
      </div>
      {renderCaption(survivor)}
    </figure>
  );
}

function ImagePairFigureItem({
  media,
  title,
  index,
  slot,
}: {
  readonly media: MediaItem;
  readonly title: string;
  readonly index: number;
  readonly slot: 0 | 1;
}): ReactElement {
  return (
    <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-surface shadow-[6px_6px_0_0_hsl(var(--color-pop-honey))]">
      <ResponsiveImage
        src={media.ref.storageKey}
        alt={
          media.altText ??
          `${title} — section image pair ${index + 1} (${slot === 0 ? 'left' : 'right'})`
        }
        width={media.ref.width ?? 1200}
        height={media.ref.height ?? 1200}
        variantSet={media.variantSet}
      />
    </div>
  );
}

function renderVideoBlock(
  block: LoadedSectionBlock,
  mediaIndex: ReadonlyMap<string, MediaItem>,
  title: string,
  index: number,
): ReactElement | null {
  const media = resolveMedia(block.mediaItemId, mediaIndex);
  if (media === null) return null;

  // Requirement 16.8 / 9.5: reuse the existing HTML5 `<video>` vs
  // iframe rule — `embedUrl` non-null → iframe, otherwise self-hosted
  // streaming source.
  if (media.embedUrl !== null) {
    return (
      <figure>
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-3xl border-2 border-foreground bg-foreground shadow-[8px_8px_0_0_hsl(var(--color-pop-caramel))]">
          <iframe
            src={media.embedUrl}
            title={`${title} — section video ${index + 1}`}
            className="absolute inset-0 h-full w-full"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
        {renderCaption(media)}
      </figure>
    );
  }

  return (
    <figure>
      <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-foreground shadow-[8px_8px_0_0_hsl(var(--color-pop-caramel))]">
        <video
          controls
          preload="metadata"
          className="aspect-[16/9] w-full"
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
      </div>
      {renderCaption(media)}
    </figure>
  );
}

function renderModel3dBlock(
  block: LoadedSectionBlock,
  mediaIndex: ReadonlyMap<string, MediaItem>,
  title: string,
): ReactElement | null {
  const media = resolveMedia(block.mediaItemId, mediaIndex);
  if (media === null) return null;

  // Extension matching is case-insensitive end-to-end: the only
  // comparison key is the lowercased value (Requirement 16.9–16.11).
  const ext = media.extension?.toLowerCase() ?? null;

  if (ext === 'glb' || ext === 'gltf') {
    const altText = media.altText ?? `${title} — interactive 3D model`;
    return (
      <figure>
        <div className="overflow-hidden rounded-3xl border-2 border-foreground bg-foreground shadow-[8px_8px_0_0_hsl(var(--color-pop-sage))]">
          <model-viewer
            src={media.ref.storageKey}
            alt={altText}
            ar
            camera-controls
            auto-rotate
            style={{ width: '100%', height: '480px', display: 'block' }}
          />
        </div>
        {renderCaption(media)}
      </figure>
    );
  }

  if (ext === 'usdz') {
    return renderUsdzAnchor(media, title);
  }

  // Any other extension (or null) — Requirement 16.11: skip silently.
  return null;
}

/**
 * Apple AR Quick Look anchor for `usdz` Media_Items (Requirement
 * 16.10). Wrapping a poster `<img>` (or, when no poster exists, a
 * plain text label) inside `<a rel="ar" href={storageKey}>` is the
 * pattern iOS Safari recognises when surfacing the AR badge.
 */
function renderUsdzAnchor(media: MediaItem, title: string): ReactElement {
  const altText = media.altText ?? `${title} — AR Quick Look (USDZ)`;
  // The `usdz` Media_Item itself is the asset; the schema does not
  // currently carry a separate poster image reference per block, so we
  // fall back to the plain text label when no caption is available.
  // Future iterations can extend `SectionBlock` with a poster slot.
  const posterStorageKey: string | null = null;

  return (
    <figure>
      <a
        rel="ar"
        href={media.ref.storageKey}
        className="block overflow-hidden rounded-3xl border-2 border-foreground bg-surface px-6 py-8 shadow-[8px_8px_0_0_hsl(var(--color-pop-sage))] hover:bg-background"
      >
        {posterStorageKey === null ? (
          <span className="font-[family-name:var(--font-display)] text-lg font-semibold tracking-[-0.02em]">
            View in AR · {altText}
          </span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={posterStorageKey} alt={altText} className="block w-full" />
        )}
      </a>
      {renderCaption(media)}
    </figure>
  );
}

function renderCaption(media: MediaItem): ReactElement | null {
  if (media.caption === null || media.caption.length === 0) return null;
  return (
    <figcaption className="mt-3 text-center text-sm italic text-muted">
      {media.caption}
    </figcaption>
  );
}

// ---------------------------------------------------------------------------
// Description fallback (no Section_Blocks)
// ---------------------------------------------------------------------------

interface DescriptionFallbackProps {
  readonly description: string;
  readonly title: string;
}

/**
 * Render `Project.description` as the primary body content when the
 * project carries zero Section_Blocks (Requirement 16.2). When the
 * description is empty after trim we render nothing — the existing
 * media stack and sidebar already handle the "nothing to say" case.
 */
function DescriptionFallback({
  description,
  title,
}: DescriptionFallbackProps): ReactElement | null {
  const trimmed = description.trim();
  if (trimmed.length === 0) return null;
  return (
    <section
      aria-label={`${title} — description`}
      className="mx-auto mb-12 max-w-[720px]"
      style={{ scrollSnapAlign: 'start' }}
    >
      <p className="whitespace-pre-line text-base leading-relaxed text-foreground">
        {trimmed}
      </p>
    </section>
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
            variantSet={media.variantSet}
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
// Media stack (legacy fallback when there are no Section_Blocks)
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
            variantSet={item.variantSet}
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
