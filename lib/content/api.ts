/**
 * Read-only content API for the public portfolio surface.
 *
 * Mirrors the `ContentApi` interface defined in `design.md` ("Server
 * components" section). Every method is read-only, hits Prisma, and maps
 * the resulting rows to the branded domain types in `lib/types/domain.ts`.
 *
 * Intentional scope limits:
 *   - All public read paths exclude `draft` and `scheduled` projects
 *     (Requirements 7.9, 7.10, 8.7, 3.10) by filtering on
 *     `status = 'published'` directly in the Prisma `where` clause, so
 *     non-published rows never enter the application layer.
 *     `getProjectBySlug` returns `null` for unknown slugs and for
 *     non-published rows so the public 404 response is byte-identical.
 *   - Sorting, filtering, and pagination logic is delegated to the pure
 *     `lib/gallery/listing.listGallery` reducer; this module only loads
 *     the candidate set from the database and projects rows into the
 *     domain types the reducer expects.
 *   - The CMS write path (`lib/cms/...`) is intentionally not implemented
 *     in this module.
 */

import type {
  Bio,
  Category,
  CategoryId,
  ContentHash,
  IsoDate,
  IsoTimestamp,
  MediaItem,
  MediaItemId,
  MediaKind,
  MediaMimeType,
  MediaRef,
  Project,
  ProjectId,
  ProjectStatus,
  Slug,
  SocialLink,
  SocialLinkId,
  Tag,
  TagId,
  VariantSet,
} from '@/lib/types/domain';
import type { GalleryPageResult, GalleryQuery } from '@/lib/types/cms';
import { prisma } from '@/lib/db/prisma';
import { listGallery } from '@/lib/gallery/listing';
import {
  selectLandingFeatured,
  type LandingFeaturedResult,
} from '@/lib/landing/featured';

// ---------------------------------------------------------------------------
// Brand-cast helpers
// ---------------------------------------------------------------------------

/**
 * Centralised brand cast. The runtime value is just a string; the cast adds
 * the phantom brand so the value can flow through the domain types.
 */
function brand<B>(value: string): B {
  return value as unknown as B;
}

function asProjectId(id: string): ProjectId {
  return brand<ProjectId>(id);
}

function asMediaItemId(id: string): MediaItemId {
  return brand<MediaItemId>(id);
}

function asCategoryId(id: string): CategoryId {
  return brand<CategoryId>(id);
}

function asTagId(id: string): TagId {
  return brand<TagId>(id);
}

function asSlug(value: string): Slug {
  return brand<Slug>(value);
}

function asContentHash(value: string): ContentHash {
  return brand<ContentHash>(value);
}

function asIsoDate(value: Date): IsoDate {
  // Format as YYYY-MM-DD in UTC so seed values round-trip predictably.
  const yyyy = value.getUTCFullYear().toString().padStart(4, '0');
  const mm = (value.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = value.getUTCDate().toString().padStart(2, '0');
  return brand<IsoDate>(`${yyyy}-${mm}-${dd}`);
}

function asIsoTimestamp(value: Date): IsoTimestamp {
  return brand<IsoTimestamp>(value.toISOString());
}

// ---------------------------------------------------------------------------
// Mime narrowing
// ---------------------------------------------------------------------------

const IMAGE_MIME_TYPES: ReadonlyArray<MediaMimeType> = [
  'image/jpeg',
  'image/png',
  'image/webp',
];
const VIDEO_MIME_TYPES: ReadonlyArray<MediaMimeType> = ['video/mp4', 'video/webm'];
const MODEL_MIME_TYPES: ReadonlyArray<MediaMimeType> = [
  'model/gltf+json',
  'model/gltf-binary',
  'model/vnd.usdz+zip',
];
const ALL_MIME_TYPES: ReadonlyArray<MediaMimeType> = [
  ...IMAGE_MIME_TYPES,
  ...VIDEO_MIME_TYPES,
  ...MODEL_MIME_TYPES,
];

function narrowMime(value: string): MediaMimeType {
  const found = ALL_MIME_TYPES.find((mime) => mime === value);
  // Defensive default: rows persisted by the CMS pipeline always supply a
  // value from the union, but if a stray row slips through we fall back to
  // image/jpeg so the renderer still gets a usable mime.
  return found ?? 'image/jpeg';
}

function narrowMediaKind(value: string): MediaKind {
  if (value === 'image' || value === 'video' || value === 'model3d') {
    return value;
  }
  return 'image';
}

function narrowProjectStatus(value: string): ProjectStatus {
  if (value === 'published' || value === 'scheduled') return value;
  return 'draft';
}

// ---------------------------------------------------------------------------
// Prisma row -> domain mappers
// ---------------------------------------------------------------------------

interface MediaItemRow {
  readonly id: string;
  readonly projectId: string;
  readonly storageKey: string;
  readonly contentHash: string;
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly durationSec: number | null;
  readonly byteSize: number;
  readonly kind: string;
  readonly altText: string | null;
  readonly caption: string | null;
  readonly ordering: number;
  readonly captionsStorageKey: string | null;
  readonly captionsContentHash: string | null;
  readonly captionsMimeType: string | null;
  readonly captionsByteSize: number | null;
  readonly transcript: string | null;
  readonly embedUrl: string | null;
  readonly extension: string | null;
  readonly variantSet: unknown;
}

function narrowVariantSet(value: unknown): VariantSet {
  // Defensive: legacy rows persisted before the variant pipeline landed
  // carry the `{}` default, which has no `renditions` / `failures` keys.
  // Treat any malformed payload as the empty fallback so the renderer
  // always sees a well-formed shape (Requirement 6.6).
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value)
  ) {
    return { renditions: [], failures: [] };
  }
  const obj = value as { renditions?: unknown; failures?: unknown };
  const renditions = Array.isArray(obj.renditions)
    ? (obj.renditions as VariantSet['renditions'])
    : [];
  const failures = Array.isArray(obj.failures)
    ? (obj.failures as VariantSet['failures'])
    : [];
  return { renditions, failures };
}

function mapMediaItem(row: MediaItemRow): MediaItem {
  const ref: MediaRef = {
    storageKey: row.storageKey,
    contentHash: asContentHash(row.contentHash),
    mimeType: narrowMime(row.mimeType),
    width: row.width,
    height: row.height,
    durationSec: row.durationSec,
    byteSize: row.byteSize,
  };

  let captionsRef: MediaRef | null = null;
  if (
    row.captionsStorageKey !== null &&
    row.captionsContentHash !== null &&
    row.captionsMimeType !== null &&
    row.captionsByteSize !== null
  ) {
    captionsRef = {
      storageKey: row.captionsStorageKey,
      contentHash: asContentHash(row.captionsContentHash),
      mimeType: narrowMime(row.captionsMimeType),
      width: null,
      height: null,
      durationSec: null,
      byteSize: row.captionsByteSize,
    };
  }

  return {
    id: asMediaItemId(row.id),
    projectId: asProjectId(row.projectId),
    ref,
    kind: narrowMediaKind(row.kind),
    altText: row.altText,
    caption: row.caption,
    ordering: row.ordering,
    captionsRef,
    transcript: row.transcript,
    embedUrl: row.embedUrl,
    extension: row.extension,
    variantSet: narrowVariantSet(row.variantSet),
  };
}

interface ProjectRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly categoryId: string;
  readonly coverMediaId: string | null;
  readonly softwareUsed: ReadonlyArray<string>;
  readonly creationDate: Date;
  readonly publishedAt: Date | null;
  readonly scheduledAt: Date | null;
  readonly status: string;
  readonly featuredOrder: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly mediaItems: ReadonlyArray<MediaItemRow>;
  readonly tags: ReadonlyArray<{ readonly tagId: string }>;
}

function mapProject(row: ProjectRow): Project {
  const mediaItems = [...row.mediaItems]
    .sort((a, b) => a.ordering - b.ordering)
    .map(mapMediaItem);

  const tagIds: ReadonlyArray<TagId> = row.tags.map((t) => asTagId(t.tagId));

  return {
    id: asProjectId(row.id),
    slug: asSlug(row.slug),
    title: row.title,
    description: row.description,
    categoryId: asCategoryId(row.categoryId),
    tagIds,
    coverMediaId: row.coverMediaId === null ? null : asMediaItemId(row.coverMediaId),
    mediaItems,
    softwareUsed: [...row.softwareUsed],
    creationDate: asIsoDate(row.creationDate),
    publishedAt: row.publishedAt === null ? null : asIsoTimestamp(row.publishedAt),
    scheduledAt: row.scheduledAt === null ? null : asIsoTimestamp(row.scheduledAt),
    status: narrowProjectStatus(row.status),
    featuredOrder: row.featuredOrder,
    createdAt: asIsoTimestamp(row.createdAt),
    updatedAt: asIsoTimestamp(row.updatedAt),
  };
}

// ---------------------------------------------------------------------------
// Repository helpers
// ---------------------------------------------------------------------------

/** Prisma include shape that matches `ProjectRow`. */
const PROJECT_INCLUDE = {
  mediaItems: true,
  tags: { select: { tagId: true } },
} as const;

/**
 * Wrap a read-only DB call so transient failures (Neon serverless
 * cold-start, build-time prerender without DB access, dropped network
 * connection) don't crash the page. Logs the error and returns the
 * supplied fallback so the UI can render an empty state instead.
 */
async function safeRead<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.warn(`[content-api] ${label} failed:`, message);
    return fallback;
  }
}

async function loadPublishedProjects(): Promise<ReadonlyArray<Project>> {
  return safeRead(
    'loadPublishedProjects',
    async () => {
      const rows = await prisma.project.findMany({
        where: { status: 'published' },
        include: PROJECT_INCLUDE,
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      });
      return rows.map((row) => mapProject(row));
    },
    [],
  );
}

async function loadConfiguredFeatured(): Promise<ReadonlyArray<Project>> {
  return safeRead(
    'loadConfiguredFeatured',
    async () => {
      const rows = await prisma.project.findMany({
        where: {
          status: 'published',
          featuredOrder: { not: null },
        },
        include: PROJECT_INCLUDE,
        orderBy: [{ featuredOrder: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => mapProject(row));
    },
    [],
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Return the projects to render in the landing page's featured section.
 *
 * The selection logic — admin-curated set when sized 3..8, otherwise the 6
 * most recent published projects, otherwise empty — is delegated to the
 * pure `selectLandingFeatured` reducer per Requirements 1.3, 1.6-1.8.
 */
export async function listFeaturedProjects(): Promise<ReadonlyArray<Project>> {
  const [configured, published] = await Promise.all([
    loadConfiguredFeatured(),
    loadPublishedProjects(),
  ]);
  const result: LandingFeaturedResult = selectLandingFeatured({ configured, published });
  return result.items;
}

/**
 * Filter, sort, and paginate the published catalogue for the Gallery view.
 * Pure pagination is performed by `listGallery`; we only load the candidate
 * rows from the database.
 */
export async function listGalleryProjects(
  query: GalleryQuery,
): Promise<GalleryPageResult> {
  const projects = await loadPublishedProjects();
  return listGallery(projects, query);
}

/**
 * Resolve a project by its public slug. Returns `null` for unknown slugs
 * and for any project whose `status` is not `published` (i.e. `draft` or
 * `scheduled`) so the public 404 response is byte-identical
 * (Requirements 3.10, 7.10, 8.7).
 *
 * The `status = 'published'` predicate is folded into the Prisma `where`
 * clause via `findFirst` (rather than the previous `findUnique` + post-
 * fetch check) so scheduled and draft rows never enter the application
 * layer at all (Requirements 7.9, 7.10). `slug` is unique in the schema,
 * so `findFirst` returns at most one row.
 */
export async function getProjectBySlug(slug: string): Promise<Project | null> {
  return safeRead(
    'getProjectBySlug',
    async () => {
      const row = await prisma.project.findFirst({
        where: { slug, status: 'published' },
        include: PROJECT_INCLUDE,
      });
      if (row === null) return null;
      return mapProject(row);
    },
    null,
  );
}

const EMPTY_BIO: Bio = {
  artistName: '',
  tagline: '',
  biography: '',
  profileImage: null,
  skills: [],
  software: [],
  socialLinks: [],
  resume: null,
  updatedAt: '1970-01-01T00:00:00.000Z' as IsoTimestamp,
};

/**
 * Load the singleton Bio record. Returns a Bio with empty fields if no
 * record has been seeded yet, OR if the DB is unreachable (build-time
 * prerender, cold start, transient outage) so the layout always renders.
 */
export async function getBio(): Promise<Bio> {
  return safeRead(
    'getBio',
    async () => {
      const row = await prisma.bio.findUnique({
        where: { id: 'singleton' },
        include: { socialLinks: { orderBy: { ordering: 'asc' } } },
      });

      if (row === null) {
        return EMPTY_BIO;
      }

      let profileImage: MediaRef | null = null;
      if (
        row.profileImageStorageKey !== null &&
        row.profileImageContentHash !== null &&
        row.profileImageMimeType !== null &&
        row.profileImageByteSize !== null
      ) {
        profileImage = {
          storageKey: row.profileImageStorageKey,
          contentHash: asContentHash(row.profileImageContentHash),
          mimeType: narrowMime(row.profileImageMimeType),
          width: row.profileImageWidth,
          height: row.profileImageHeight,
          durationSec: null,
          byteSize: row.profileImageByteSize,
        };
      }

      let resume: MediaRef | null = null;
      if (
        row.resumeStorageKey !== null &&
        row.resumeContentHash !== null &&
        row.resumeMimeType !== null &&
        row.resumeByteSize !== null
      ) {
        // Resume PDF is not in the strict MediaMimeType union; we narrow it
        // to the safe default since the bio page renders the resume as a
        // download link, not an image. The mime is preserved on the raw
        // storageKey at the CDN edge.
        resume = {
          storageKey: row.resumeStorageKey,
          contentHash: asContentHash(row.resumeContentHash),
          mimeType: narrowMime(row.resumeMimeType),
          width: null,
          height: null,
          durationSec: null,
          byteSize: row.resumeByteSize,
        };
      }

      const socialLinks: ReadonlyArray<SocialLink> = row.socialLinks.map(
        (link) => ({
          id: brand<SocialLinkId>(link.id),
          platform: link.platform,
          url: link.url,
          ordering: link.ordering,
        }),
      );

      return {
        artistName: row.artistName,
        tagline: row.tagline,
        biography: row.biography,
        profileImage,
        skills: [...row.skills],
        software: [...row.software],
        socialLinks,
        resume,
        updatedAt: asIsoTimestamp(row.updatedAt),
      };
    },
    EMPTY_BIO,
  );
}

/**
 * Return all categories ordered by `ordering` ascending. Used to populate
 * the Gallery's category filter chips.
 */
export async function listCategories(): Promise<ReadonlyArray<Category>> {
  return safeRead(
    'listCategories',
    async () => {
      const rows = await prisma.category.findMany({
        orderBy: [{ ordering: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => ({
        id: asCategoryId(row.id),
        name: row.name,
        ordering: row.ordering,
      }));
    },
    [],
  );
}

/**
 * Return all tags ordered by `ordering` ascending. Used to populate the
 * Gallery's tag filter chips.
 */
export async function listTags(): Promise<ReadonlyArray<Tag>> {
  return safeRead(
    'listTags',
    async () => {
      const rows = await prisma.tag.findMany({
        orderBy: [{ ordering: 'asc' }, { id: 'asc' }],
      });
      return rows.map((row) => ({
        id: asTagId(row.id),
        label: row.label,
        ordering: row.ordering,
      }));
    },
    [],
  );
}

/**
 * Return all published projects (with media items) for adjacency lookups
 * and other read paths that need the full catalogue.
 */
export async function listPublishedProjects(): Promise<ReadonlyArray<Project>> {
  return loadPublishedProjects();
}
