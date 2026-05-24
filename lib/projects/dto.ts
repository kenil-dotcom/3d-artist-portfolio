/**
 * Project tile and detail DTO builders.
 *
 * These pure functions translate a `Project` (plus its taxonomy lookups and
 * resolved cover URL) into the shapes consumed by the public Gallery tile
 * (`buildProjectTile`) and the Project_Detail_Page (`buildProjectDetail`).
 *
 * The builders are I/O-free, time-free, and never read globals: given the
 * same inputs they return structurally identical outputs. This makes them
 * safe to drive from property-based tests and lets server and client paths
 * share the same projection logic.
 *
 * Spec references:
 * - Requirement 2.2 — gallery tile must include the project title (truncated
 *   to 80 chars), the primary category name, and a cover image; if no cover
 *   image is assigned, a placeholder image must be shown in its place.
 * - Requirement 2.7 — tile activation navigates to the Project_Detail_Page,
 *   so each tile DTO carries a stable `href = /projects/{slug}`.
 * - Requirement 3.1 — the detail page renders title, description, category,
 *   tags, creation date, and software used, with placeholders for empty
 *   fields rather than omitting the field labels.
 * - Requirement 3.2 — media items render in their stored order; when there
 *   are zero items the page shows a "No media available" message.
 *
 * Design references:
 * - "Property 4: Project tile DTO completeness" — title truncated to <= 80
 *   chars, `categoryName` resolved from `categoryId`, `coverImage` non-null
 *   (project's cover when present, otherwise placeholder), and a navigable
 *   href of the form `/projects/{slug}`.
 * - "Property 5: Project detail field rendering completeness" — all six
 *   labelled fields are present regardless of which are null/empty, missing
 *   values render the placeholder marker, `mediaItems` ordering is exactly
 *   preserved, and `noMediaMessage = true` iff `mediaItems.length === 0`.
 */

import type {
  Category,
  IsoDate,
  MediaItem,
  Project,
  Tag,
} from "@/lib/types/domain";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Maximum number of characters rendered for a project title on a Gallery
 * tile (Requirement 2.2). Titles longer than this are truncated; the
 * `titleTruncated` flag on the DTO records that truncation occurred so the
 * UI can decide whether to show a tooltip with the full title.
 */
export const PROJECT_TILE_TITLE_MAX = 80;

/**
 * Sentinel string rendered in place of a missing or empty detail field
 * (Requirement 3.1). Em dash chosen because it is a single visible glyph
 * that does not localise to any specific language.
 */
export const PROJECT_FIELD_PLACEHOLDER = "—";

/**
 * Message shown on a Project_Detail_Page when the project has zero media
 * items attached (Requirement 3.2).
 */
export const PROJECT_NO_MEDIA_MESSAGE = "No media available";

/**
 * Accessible label associated with the placeholder cover image rendered
 * when a project has no cover assigned (Requirement 2.2). Callers wire this
 * into `<img alt>` or an `aria-label` on the placeholder element.
 */
export const PROJECT_TILE_COVER_PLACEHOLDER_LABEL = "Cover image not available";

/**
 * Month names used by `formatCreationDate`. Hard-coded English so the
 * formatter is locale-independent and deterministic for property tests.
 */
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

// ---------------------------------------------------------------------------
// DTO shapes
// ---------------------------------------------------------------------------

/**
 * The cover image slot on a Gallery tile. `kind === "cover"` carries the
 * resolved cover URL; `kind === "placeholder"` signals to the UI that it
 * should render the shared placeholder image (Requirement 2.2). The slot is
 * never absent: per Property 4 every tile has a non-null `coverImage`.
 */
export type TileCoverImage =
  | { readonly kind: "cover"; readonly url: string }
  | { readonly kind: "placeholder"; readonly label: string };

/**
 * DTO consumed by Gallery tile components.
 */
export interface ProjectTileDTO {
  /** Project slug, copied verbatim. */
  readonly slug: string;
  /** Stable href for navigation: `/projects/{slug}` (Requirement 2.7). */
  readonly href: string;
  /** Title, truncated to {@link PROJECT_TILE_TITLE_MAX} chars. */
  readonly title: string;
  /**
   * `true` iff the original project title exceeded
   * {@link PROJECT_TILE_TITLE_MAX} characters and was shortened.
   */
  readonly titleTruncated: boolean;
  /** Resolved category name, or the placeholder when the lookup misses. */
  readonly categoryName: string;
  /**
   * Whether the category lookup hit; `false` indicates the tile is showing
   * the placeholder category text rather than a real category name.
   */
  readonly categoryNamePlaceholder: boolean;
  /** Always present (Property 4); see {@link TileCoverImage}. */
  readonly coverImage: TileCoverImage;
}

/**
 * Per-field flags indicating whether the corresponding field on
 * {@link ProjectDetailDTO} is currently rendering its placeholder marker.
 *
 * Property 5 requires every labelled field to be present regardless of
 * whether the underlying value is null or empty; these flags let the UI
 * style the placeholder visibly differently from real content (e.g. dim
 * text, italic) while keeping the DTO shape uniform.
 */
export interface ProjectDetailPlaceholders {
  readonly title: boolean;
  readonly description: boolean;
  readonly categoryName: boolean;
  readonly tagLabels: boolean;
  readonly creationDate: boolean;
  readonly softwareUsed: boolean;
}

/**
 * DTO consumed by the Project_Detail_Page.
 *
 * Every labelled string field is always populated: when the underlying
 * value is missing we substitute {@link PROJECT_FIELD_PLACEHOLDER} (or an
 * empty array for the list-shaped fields) and flag the substitution in
 * {@link ProjectDetailPlaceholders} so the UI can style it.
 */
export interface ProjectDetailDTO {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly categoryName: string;
  /** Ordered to match `project.tagIds`; unknown ids are skipped. */
  readonly tagLabels: ReadonlyArray<string>;
  /** Human-formatted (e.g. "May 12, 2024") or the placeholder marker. */
  readonly creationDate: string;
  readonly softwareUsed: ReadonlyArray<string>;
  /** Exact, order-preserving copy of `mediaItems` (Property 5). */
  readonly mediaItems: ReadonlyArray<MediaItem>;
  /** `true` iff `mediaItems.length === 0` (Requirement 3.2). */
  readonly noMediaMessage: boolean;
  readonly placeholders: ProjectDetailPlaceholders;
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

/**
 * Build a Gallery tile DTO for a single project.
 *
 * @param project        The project being projected.
 * @param category       The resolved {@link Category} record for
 *                       `project.categoryId`, or `null` if the caller could
 *                       not resolve it (e.g. a deleted/orphaned category).
 *                       When `null`, `categoryName` is set to the
 *                       placeholder marker and `categoryNamePlaceholder` is
 *                       `true`.
 * @param coverMediaUrl  Pre-resolved URL for the project's cover image, or
 *                       `null` when no cover is available. When `null` the
 *                       returned `coverImage.kind` is `"placeholder"` so
 *                       the tile still has a cover slot to render
 *                       (Requirement 2.2).
 *
 * @remarks Pure: no side effects, no time/randomness, deterministic given
 * inputs. Returns a fresh object on each call.
 */
export function buildProjectTile(
  project: Project,
  category: Category | null,
  coverMediaUrl: string | null,
): ProjectTileDTO {
  const truncated = truncateTitle(project.title);
  const slug: string = project.slug as unknown as string;

  const categoryResolved = category !== null;
  const categoryName = categoryResolved
    ? category.name
    : PROJECT_FIELD_PLACEHOLDER;

  const coverImage: TileCoverImage =
    coverMediaUrl === null
      ? { kind: "placeholder", label: PROJECT_TILE_COVER_PLACEHOLDER_LABEL }
      : { kind: "cover", url: coverMediaUrl };

  return {
    slug,
    href: `/projects/${slug}`,
    title: truncated.value,
    titleTruncated: truncated.truncated,
    categoryName,
    categoryNamePlaceholder: !categoryResolved,
    coverImage,
  };
}

/**
 * Build the DTO consumed by the Project_Detail_Page.
 *
 * @param project     The project being projected.
 * @param category    The resolved {@link Category} record, or `null` when
 *                    unresolved. A `null` category causes `categoryName`
 *                    to render the placeholder marker.
 * @param tags        Pool of tag records used to resolve `project.tagIds`
 *                    into display labels. Order of the input is irrelevant;
 *                    the output `tagLabels` follows `project.tagIds` order.
 *                    Unknown ids are skipped silently — the project's
 *                    edit form is responsible for keeping ids in sync, and
 *                    surfacing a half-rendered tag list to a Visitor would
 *                    be worse than dropping the orphan.
 * @param mediaItems  Ordered list of media items to render. Most callers
 *                    pass `project.mediaItems` directly; the parameter is
 *                    explicit so adapters can pass an enriched/filtered
 *                    list (e.g. with resolved variant URLs already
 *                    attached) without having to reconstruct the project.
 *                    The DTO copies this list reference verbatim.
 *
 * @remarks Pure: no side effects, no time/randomness, deterministic given
 * inputs. Returns a fresh object on each call. Does not mutate any input
 * array.
 */
export function buildProjectDetail(
  project: Project,
  category: Category | null,
  tags: ReadonlyArray<Tag>,
  mediaItems: ReadonlyArray<MediaItem>,
): ProjectDetailDTO {
  const titleValue = project.title.trim();
  const titleIsPlaceholder = titleValue.length === 0;
  const title = titleIsPlaceholder ? PROJECT_FIELD_PLACEHOLDER : titleValue;

  const descriptionValue = project.description.trim();
  const descriptionIsPlaceholder = descriptionValue.length === 0;
  const description = descriptionIsPlaceholder
    ? PROJECT_FIELD_PLACEHOLDER
    : descriptionValue;

  const categoryResolved = category !== null;
  const categoryName = categoryResolved
    ? category.name
    : PROJECT_FIELD_PLACEHOLDER;

  const tagLabels = resolveTagLabels(project.tagIds, tags);
  const tagLabelsIsPlaceholder = tagLabels.length === 0;

  const creationDate = formatCreationDate(project.creationDate);
  const creationDateIsPlaceholder = creationDate === PROJECT_FIELD_PLACEHOLDER;

  const softwareUsed = project.softwareUsed.filter(
    (entry) => entry.trim().length > 0,
  );
  const softwareUsedIsPlaceholder = softwareUsed.length === 0;

  return {
    slug: project.slug as unknown as string,
    title,
    description,
    categoryName,
    tagLabels,
    creationDate,
    softwareUsed,
    mediaItems: mediaItems.slice(),
    noMediaMessage: mediaItems.length === 0,
    placeholders: {
      title: titleIsPlaceholder,
      description: descriptionIsPlaceholder,
      categoryName: !categoryResolved,
      tagLabels: tagLabelsIsPlaceholder,
      creationDate: creationDateIsPlaceholder,
      softwareUsed: softwareUsedIsPlaceholder,
    },
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface TruncatedTitle {
  readonly value: string;
  readonly truncated: boolean;
}

/**
 * Truncate `title` to at most {@link PROJECT_TILE_TITLE_MAX} characters.
 *
 * Truncation operates on JavaScript "code units" (UTF-16). For the title
 * lengths the CMS accepts (1..120 chars), this is consistent with the
 * length validation applied at write time by `validateProjectInput`.
 *
 * Returns both the (possibly shortened) value and a `truncated` flag so
 * callers can branch UI on whether the full title is visible.
 */
function truncateTitle(title: string): TruncatedTitle {
  if (title.length <= PROJECT_TILE_TITLE_MAX) {
    return { value: title, truncated: false };
  }
  return {
    value: title.slice(0, PROJECT_TILE_TITLE_MAX),
    truncated: true,
  };
}

/**
 * Resolve `tagIds` (in their stored order) into display labels using the
 * supplied `tags` pool. Ids that have no matching {@link Tag} record are
 * skipped — see the `tags` parameter doc on {@link buildProjectDetail} for
 * the rationale.
 */
function resolveTagLabels(
  tagIds: ReadonlyArray<Tag["id"] | string>,
  tags: ReadonlyArray<Tag>,
): ReadonlyArray<string> {
  if (tagIds.length === 0 || tags.length === 0) {
    return [];
  }
  const byId = new Map<string, string>();
  for (const tag of tags) {
    byId.set(tag.id as unknown as string, tag.label);
  }
  const labels: string[] = [];
  for (const id of tagIds) {
    const label = byId.get(id as unknown as string);
    if (label !== undefined) {
      labels.push(label);
    }
  }
  return labels;
}

/**
 * Format an `IsoDate` ("YYYY-MM-DD") as "Month DD, YYYY" using English
 * month names. The formatter is deterministic and locale-independent so
 * its output is safe to assert in tests.
 *
 * Defensive: when `date` cannot be parsed into a sensible
 * year/month/day triple, returns the placeholder marker rather than
 * throwing or echoing back garbage. The CMS validates `creationDate` at
 * write time, so this path is purely a safety net.
 */
function formatCreationDate(date: IsoDate | null | undefined): string {
  if (date === null || date === undefined) {
    return PROJECT_FIELD_PLACEHOLDER;
  }
  const value = String(date).trim();
  if (value.length === 0) {
    return PROJECT_FIELD_PLACEHOLDER;
  }

  // Strict YYYY-MM-DD parse; reject anything else.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) {
    return PROJECT_FIELD_PLACEHOLDER;
  }
  const year = Number.parseInt(match[1] as string, 10);
  const month = Number.parseInt(match[2] as string, 10);
  const day = Number.parseInt(match[3] as string, 10);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return PROJECT_FIELD_PLACEHOLDER;
  }

  const monthName = MONTH_NAMES[month - 1] as string;
  return `${monthName} ${day}, ${year}`;
}
