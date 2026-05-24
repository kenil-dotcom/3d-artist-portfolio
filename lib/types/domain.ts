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
 * `draft` projects are CMS-only.
 */
export type ProjectStatus = "draft" | "published";

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
export type ModelMimeType = "model/gltf+json" | "model/gltf-binary";

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
