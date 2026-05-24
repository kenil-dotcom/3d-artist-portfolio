/**
 * Core domain types for the 3D Artist Portfolio.
 *
 * These types mirror the Domain Models section of `design.md` and are kept
 * pure (no I/O, no framework imports) so they can be consumed by both server
 * and client code paths and exercised by property-based tests.
 *
 * All identifiers are branded so that, for example, a `ProjectId` cannot be
 * implicitly assigned to a `MediaItemId`.
 */

import type { Brand } from "./brand";

// ---------------------------------------------------------------------------
// Branded identifiers
// ---------------------------------------------------------------------------

export type ProjectId = Brand<string, "ProjectId">;
export type MediaItemId = Brand<string, "MediaItemId">;
export type CategoryId = Brand<string, "CategoryId">;
export type TagId = Brand<string, "TagId">;
export type SocialLinkId = Brand<string, "SocialLinkId">;

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * ISO-8601 date string at calendar-day granularity, e.g. `"2024-05-12"`.
 */
export type IsoDate = Brand<string, "IsoDate">;

/**
 * ISO-8601 timestamp with timezone, e.g. `"2024-05-12T17:42:00.000Z"`.
 */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;

/**
 * Lower-case URL slug matching `^[a-z0-9]+(-[a-z0-9]+)*$`, length 1..80.
 * Validated by `validateSlug` in `lib/validation/project.ts`.
 */
export type Slug = Brand<string, "Slug">;

/**
 * Hex-encoded SHA-256 content hash used in immutable media URLs.
 */
export type ContentHash = Brand<string, "ContentHash">;

/**
 * Project publication status. `published` projects are visible to Visitors;
 * `scheduled` projects flip to `published` at `scheduledAt`; `draft` projects
 * are CMS-only.
 */
export type ProjectStatus = "draft" | "scheduled" | "published";

/**
 * Discriminator for the kind of media stored in a `MediaItem`.
 */
export type MediaKind = "image" | "video" | "model3d";

/**
 * Allowed image MIME types for project media items and reference images.
 */
export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

/**
 * Allowed video MIME types for project media items.
 */
export type VideoMimeType = "video/mp4" | "video/webm";

/**
 * Allowed 3D model MIME types for project media items.
 */
export type ModelMimeType =
  | "model/gltf+json"
  | "model/gltf-binary"
  | "model/vnd.usdz+zip";

/**
 * Union of every MIME type that may be carried by a `MediaRef`.
 */
export type MediaMimeType = ImageMimeType | VideoMimeType | ModelMimeType;

// ---------------------------------------------------------------------------
// Media references
// ---------------------------------------------------------------------------

/**
 * Pointer to a binary asset in object storage along with the metadata needed
 * to render or stream it. `MediaRef` is intentionally URL-free: callers
 * compose URLs at the edge using `storageKey` + `contentHash` so URLs are
 * cache-immutable.
 */
export interface MediaRef {
  /** Canonical key in object storage (e.g. `media/2024/abc.jpg`). */
  readonly storageKey: string;
  /** SHA-256 of the original bytes; embedded in immutable URLs. */
  readonly contentHash: ContentHash;
  /** MIME type of the underlying asset. */
  readonly mimeType: MediaMimeType;
  /** Pixel width when known (images, video frames). */
  readonly width: number | null;
  /** Pixel height when known (images, video frames). */
  readonly height: number | null;
  /** Duration in seconds for time-based media; `null` for stills/models. */
  readonly durationSec: number | null;
  /** Size of the stored object in bytes. */
  readonly byteSize: number;
}

// ---------------------------------------------------------------------------
// Taxonomy
// ---------------------------------------------------------------------------

/**
 * Top-level Project classification (e.g. "Renders", "Models", "Animations").
 */
export interface Category {
  readonly id: CategoryId;
  /** Display name, 1..60 chars. */
  readonly name: string;
  /** Position used for ordering in filter controls. */
  readonly ordering: number;
}

/**
 * Free-form Project label used for conjunctive filtering in the Gallery.
 */
export interface Tag {
  readonly id: TagId;
  /** Display label, 1..40 chars. */
  readonly label: string;
  /** Position used for ordering in filter controls. */
  readonly ordering: number;
}

// ---------------------------------------------------------------------------
// Media items
// ---------------------------------------------------------------------------

/**
 * A single piece of content within a Project. Order is determined by
 * `ordering`; reorder operations rewrite this field transactionally.
 */
export interface MediaItem {
  readonly id: MediaItemId;
  readonly projectId: ProjectId;
  readonly ref: MediaRef;
  readonly kind: MediaKind;
  /**
   * Alternative text for assistive technologies. Required at publish time
   * for image media (Requirement 10.4); may be `null` for decorative images
   * marked as such elsewhere.
   */
  readonly altText: string | null;
  /** Optional caption shown beneath the media, 0..200 chars. */
  readonly caption: string | null;
  /** 0-based position within the project. */
  readonly ordering: number;
  /** Optional WebVTT track for video captions. */
  readonly captionsRef: MediaRef | null;
  /** Optional plain-text transcript for video accessibility. */
  readonly transcript: string | null;
  /**
   * Optional embed URL for externally hosted media (YouTube/Vimeo). When
   * set the public site renders an iframe instead of streaming
   * `ref.storageKey` directly. Mutually exclusive with file uploads at
   * the application layer; the column is nullable so file-upload media
   * items leave it as `null`.
   */
  readonly embedUrl: string | null;
  /**
   * Lowercase file extension persisted from the validated MIME on upload
   * (`jpg`, `png`, `webp`, `mp4`, `webm`, `glb`, `gltf`, `usdz`). Used by
   * the public renderer to pick the correct viewer (notably the
   * `<model-viewer>` vs Apple Quick Look split for `usdz`). Null for
   * legacy rows whose extension was not recorded at upload time.
   */
  readonly extension: string | null;
  /**
   * Derived AVIF/WebP renditions plus a per-rendition failure log. The
   * public renderer treats an empty `renditions` array as the legacy
   * fallback path (Requirement 6.6).
   */
  readonly variantSet: VariantSet;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

/**
 * A curated collection of related media items representing a single body of
 * 3D work. Public visibility is controlled by `status`; only `published`
 * projects are exposed to Visitors.
 */
export interface Project {
  readonly id: ProjectId;
  readonly slug: Slug;
  /** 1..120 chars. */
  readonly title: string;
  /** 0..5000 chars; rendered as plain text or sanitized markdown. */
  readonly description: string;
  readonly categoryId: CategoryId;
  /** 0..20 tags. */
  readonly tagIds: ReadonlyArray<TagId>;
  /** Designated cover image; `null` until the Admin selects one. */
  readonly coverMediaId: MediaItemId | null;
  /** Ordered media list; must be non-empty to publish. */
  readonly mediaItems: ReadonlyArray<MediaItem>;
  /** 0..20 entries, each 1..60 chars. */
  readonly softwareUsed: ReadonlyArray<string>;
  /** Calendar date the work was produced; must be on or before today. */
  readonly creationDate: IsoDate;
  /** Set when status flips to `published`; cleared on unpublish. */
  readonly publishedAt: IsoTimestamp | null;
  /**
   * Future UTC timestamp at which a `scheduled` Project transitions to
   * `published`. Non-null exactly when `status === 'scheduled'`; cleared on
   * any other status (Requirement 7.5–7.6).
   */
  readonly scheduledAt: IsoTimestamp | null;
  readonly status: ProjectStatus;
  /**
   * Position in the featured list, 0..11 if featured, `null` otherwise.
   * Distinct across all projects when set.
   */
  readonly featuredOrder: number | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Bio
// ---------------------------------------------------------------------------

/**
 * External profile link displayed on the Bio page (ArtStation, Instagram,
 * LinkedIn, etc.). Renders with `target="_blank" rel="noopener noreferrer"`.
 */
export interface SocialLink {
  readonly id: SocialLinkId;
  /** Platform display name, 1..40 chars. */
  readonly platform: string;
  /** Absolute https URL, length <= 2048. */
  readonly url: string;
  /** Position used for ordering on the Bio page. */
  readonly ordering: number;
}

/**
 * The Artist's bio content. There is exactly one Bio record per site.
 */
export interface Bio {
  /** 1..100 chars; rendered on landing and bio pages. */
  readonly artistName: string;
  /** 1..160 chars, no line breaks. */
  readonly tagline: string;
  /** 0..5000 chars. */
  readonly biography: string;
  readonly profileImage: MediaRef | null;
  /** 0..30 entries, each 1..60 chars. */
  readonly skills: ReadonlyArray<string>;
  /** 0..30 entries, each 1..60 chars. */
  readonly software: ReadonlyArray<string>;
  /** 0..15 entries. */
  readonly socialLinks: ReadonlyArray<SocialLink>;
  /** PDF up to 20 MB; `null` when the Admin has not uploaded a CV. */
  readonly resume: MediaRef | null;
  readonly updatedAt: IsoTimestamp;
}
// ---------------------------------------------------------------------------
// Variant_Set
// ---------------------------------------------------------------------------

/**
 * Image rendition format produced by the variant pipeline. Both formats are
 * generated for every selected width to give the browser two acceptable
 * options inside a `<picture>` element.
 */
export type VariantFormat = "avif" | "webp";

/**
 * A single derived rendition of an image Media_Item. One Variant per
 * `(format, width)` pair; the public renderer picks the smallest acceptable
 * rendition via a `<picture>` / `<source>` element (Requirement 6.5).
 */
export interface Variant {
  readonly format: VariantFormat;
  /** Target width in pixels; one of 400, 800, 1600, 2400. */
  readonly width: number;
  /** Resulting height in pixels after aspect-ratio-preserving resize. */
  readonly height: number;
  /** Public URL of the rendition object in R2. */
  readonly storageKey: string;
  /** Size of the rendition object in bytes. */
  readonly byteSize: number;
}

/**
 * Recorded failure for a single `(format, width)` rendition that exhausted
 * its retry budget without succeeding (Requirement 6.4 / 6.7). Other
 * renditions in the same set may still have succeeded.
 */
export interface VariantFailure {
  readonly format: VariantFormat;
  /** Target width that failed to encode. */
  readonly width: number;
  /** Sharp error message, truncated to at most 200 characters. */
  readonly cause: string;
}

/**
 * Map of derived renditions plus a per-rendition failure log for a single
 * image Media_Item. Persisted on `MediaItem.variantSet` as JSON. Empty
 * (`{ renditions: [], failures: [] }`) for video, model3d, and embed rows;
 * the public renderer treats an empty `renditions` array as the legacy
 * fallback path (Requirement 6.6).
 */
export interface VariantSet {
  readonly renditions: ReadonlyArray<Variant>;
  readonly failures: ReadonlyArray<VariantFailure>;
}

// ---------------------------------------------------------------------------
// Section_Block
// ---------------------------------------------------------------------------

export type SectionBlockId = Brand<string, "SectionBlockId">;

/**
 * Discriminator for the kind of body content carried by a Section_Block.
 * `text` blocks carry sanitised HTML in `body`; the four media-bearing kinds
 * carry one or two references to Media_Items belonging to the same Project.
 */
export type SectionBlockKind =
  | "text"
  | "image"
  | "image_pair"
  | "video"
  | "model3d";

/**
 * A typed unit inside a Project's body. `body` is non-null exactly when
 * `kind === 'text'`. `mediaItemId` is non-null for `image`, `video`,
 * `model3d`, and the first slot of `image_pair`. `mediaItemBId` is non-null
 * only for the second slot of `image_pair`. Application logic enforces that
 * `(projectId, ordering)` forms a contiguous integer sequence starting at 0.
 */
export interface SectionBlock {
  readonly id: SectionBlockId;
  readonly projectId: ProjectId;
  readonly kind: SectionBlockKind;
  /** 0-based position within the project's section list. */
  readonly ordering: number;
  /**
   * Sanitised HTML body for `text` kind, 1..10000 chars after trim and
   * sanitisation. Null for media-bearing kinds.
   */
  readonly body: string | null;
  /**
   * Primary Media_Item reference for `image`, `video`, `model3d`, and the
   * first slot of `image_pair`. Null for `text`. May become null if the
   * referenced Media_Item is deleted (the relation is `SetNull`).
   */
  readonly mediaItemId: MediaItemId | null;
  /**
   * Secondary Media_Item reference for the second slot of `image_pair`.
   * Null for every other kind. May become null if the referenced
   * Media_Item is deleted.
   */
  readonly mediaItemBId: MediaItemId | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}
