/**
 * ResponsiveImage — minimal server-rendered image wrapper.
 *
 * Renders an `<img>` (or, when an AVIF/WebP `VariantSet` is supplied,
 * a `<picture>` element with format-specific `<source>` candidates and
 * the original `<img>` as the universal fallback).
 *
 * Spec references:
 *   - Requirement 4.4 (lazy load images outside the viewport).
 *   - Requirement 4.6 (placeholder while the asset is loading).
 *   - Requirement 6.5 (emit `<picture>` with AVIF/WebP candidates when
 *     a Variant_Set is available).
 *   - Requirement 6.6 (legacy rows or in-flight generation fall back to
 *     the single-source `<img src={storageKey}>` rendering).
 *   - Requirement 10.4 (`alt` text required for image media).
 */

import type { CSSProperties } from 'react';

import type { Variant, VariantFormat, VariantSet } from '@/lib/types/domain';

interface ResponsiveImageProps {
  /** Absolute or root-relative URL to the image asset. */
  readonly src: string;
  /** Accessible alternative text. Required at the type level (Req 10.4). */
  readonly alt: string;
  /** Intrinsic width of the source image, used to reserve layout space. */
  readonly width: number;
  /** Intrinsic height of the source image, used to reserve layout space. */
  readonly height: number;
  /** Optional sizing class (e.g. `object-cover h-full w-full`). */
  readonly className?: string;
  /**
   * Fetch priority hint. `eager` skips the lazy-load deferral for above-the-
   * fold imagery (Hero, first gallery tile).
   */
  readonly priority?: boolean;
  /**
   * Optional set of derived AVIF/WebP renditions for this image. When
   * `renditions.length > 0` the component emits a `<picture>` element with
   * `<source type="image/avif">` and `<source type="image/webp">` candidates
   * plus the original `<img>` as the universal fallback. When the prop is
   * absent or `renditions` is empty (legacy rows or in-flight generation),
   * the component falls back to a bare `<img src={src}>` (Requirement 6.6).
   */
  readonly variantSet?: VariantSet;
}

const PLACEHOLDER_STYLE: CSSProperties = {
  // Soft neutral blur block; visible until the image paints over it.
  background:
    'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))',
};

const FORMAT_MIME: Readonly<Record<VariantFormat, string>> = {
  avif: 'image/avif',
  webp: 'image/webp',
};

/**
 * Build a `srcset`-style string for a given format from a Variant_Set.
 * Renditions are filtered to the requested format and sorted ascending by
 * width so the browser picks the smallest acceptable candidate.
 *
 * Returns `null` when no rendition exists for the format so the caller can
 * skip emitting an empty `<source>` element.
 */
function buildSrcSet(
  renditions: ReadonlyArray<Variant>,
  format: VariantFormat,
): string | null {
  const matches = renditions
    .filter((r) => r.format === format)
    .slice()
    .sort((a, b) => a.width - b.width);
  if (matches.length === 0) return null;
  return matches.map((r) => `${r.storageKey} ${r.width}w`).join(', ');
}

export function ResponsiveImage({
  src,
  alt,
  width,
  height,
  className,
  priority = false,
  variantSet,
}: ResponsiveImageProps): JSX.Element {
  const loading = priority ? 'eager' : 'lazy';
  const classes = ['responsive-image', className ?? ''].filter(Boolean).join(' ');

  const renditions = variantSet?.renditions ?? [];
  const hasVariants = renditions.length > 0;
  const avifSrcSet = hasVariants ? buildSrcSet(renditions, 'avif') : null;
  const webpSrcSet = hasVariants ? buildSrcSet(renditions, 'webp') : null;

  // eslint-disable-next-line @next/next/no-img-element
  const imgEl = (
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      className={classes}
    />
  );

  return (
    <span
      className="responsive-image-frame"
      style={PLACEHOLDER_STYLE}
      data-priority={priority ? 'true' : 'false'}
    >
      {hasVariants ? (
        <picture>
          {avifSrcSet !== null ? (
            <source type={FORMAT_MIME.avif} srcSet={avifSrcSet} />
          ) : null}
          {webpSrcSet !== null ? (
            <source type={FORMAT_MIME.webp} srcSet={webpSrcSet} />
          ) : null}
          {imgEl}
        </picture>
      ) : (
        imgEl
      )}
    </span>
  );
}

export default ResponsiveImage;
