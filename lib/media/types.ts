/**
 * Shared types for the media pipeline (`lib/media/*`).
 *
 * These types model the variants produced by `buildImageVariants` and
 * consumed by content negotiation (`chooseImageFormat`, `pickVariant`) and by
 * the public-facing `<picture>` rendering in `ResponsiveImage`.
 *
 * Kept dependency-free so they can be exercised by property-based tests.
 */

/**
 * Concrete image format that can be served for a still image media item.
 *
 * Ordered by preference: AVIF is the most efficient, WebP next, with JPEG
 * acting as the universally supported fallback (Requirements 4.2 and 4.3).
 */
export type ImageFormat = "avif" | "webp" | "jpeg";

/**
 * A single responsive image variant in object storage.
 *
 * Variants are immutable: `url` embeds the originating asset's content hash
 * so it can be served with `Cache-Control: public, max-age=31536000, immutable`.
 *
 * The `lib/media` pipeline guarantees:
 * - `width` is a positive integer in pixels and never exceeds the original
 *   asset's width (no upscaling).
 * - `bytes` is the size of the encoded variant on disk.
 * - At least one variant exists per band (`<=480`, `481..1024`, `>=1025`)
 *   for every image media item, in each supported `format`.
 */
export interface ImageVariant {
  /** Immutable, content-hash-keyed URL to the encoded variant. */
  readonly url: string;
  /** Encoded width in pixels; positive integer. */
  readonly width: number;
  /** Encoded image format. */
  readonly format: ImageFormat;
  /** Size of the encoded variant on disk, in bytes. */
  readonly bytes: number;
}
